/**
 * InfinityPay API - Connected Payment Accounts Endpoints
 * Manages merchant payment accounts, verification, activation exclusivity, and transaction sync.
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { sendSuccess, sendError, ErrorCodes } = require('../responses');
const { accountService, transactionService } = require('../db');
const { validateMobile, validateUpiId, validateEmail } = require('../validation');
const { authenticateApiKey } = require('../auth');
const { syncTransactions, connectMailbox } = require('../gmail');

// All account endpoints require merchant API key authentication
router.use(authenticateApiKey);

/**
 * POST /api/accounts
 * Connects a new payment account for the merchant.
 * Limit: Maximum 3 accounts per merchant.
 * Initial State: verification_status = "pending", status = "inactive"
 */
router.post('/', async (req, res) => {
  try {
    const { phone_number, upi_id, email, mailbox_credentials } = req.body;

    // 1. Check account limit
    const existingCount = await accountService.countByMerchant(req.merchant.id);
    if (existingCount >= config.accounts.maxPerMerchant) {
      return sendError(
        res,
        `Maximum account limit reached (${config.accounts.maxPerMerchant} accounts per merchant).`,
        ErrorCodes.ACCOUNT_LIMIT_REACHED,
        400
      );
    }

    // 2. Validate inputs
    const mobileValidation = validateMobile(phone_number);
    if (!mobileValidation.valid || !mobileValidation.mobile) {
      return sendError(res, mobileValidation.error || 'Valid phone number is required.', ErrorCodes.INVALID_MOBILE, 400);
    }

    const upiValidation = validateUpiId(upi_id);
    if (!upiValidation.valid) {
      return sendError(res, upiValidation.error, ErrorCodes.VALIDATION_ERROR, 400);
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return sendError(res, emailValidation.error, ErrorCodes.VALIDATION_ERROR, 400);
    }

    // 3. Create account with pending & inactive initial status
    const account = await accountService.create({
      merchantId: req.merchant.id,
      phoneNumber: mobileValidation.mobile,
      upiId: upiValidation.upiId,
      email: emailValidation.email,
    });

    // 4. Optionally setup encrypted mailbox connection if credentials provided
    if (mailbox_credentials) {
      await connectMailbox(account.id, {
        email: emailValidation.email,
        authType: 'app_password',
        credentials: mailbox_credentials,
      });
    }

    return sendSuccess(
      res,
      'Connected payment account created. Verification is required before activation.',
      {
        account_id: account.id,
        phone_number: account.phoneNumber,
        upi_id: account.upiId,
        email: account.email,
        verification_status: account.verificationStatus,
        status: account.status,
        created_at: account.createdAt,
      },
      201
    );
  } catch (error) {
    return sendError(res, error.message || 'Failed to create account.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * GET /api/accounts
 * Return merchant's connected accounts (max 3).
 */
router.get('/', async (req, res) => {
  try {
    const accounts = await accountService.listByMerchant(req.merchant.id);
    const normalized = accounts.map((a) => ({
      account_id: a.id,
      phone_number: a.phoneNumber,
      upi_id: a.upiId,
      email: a.email,
      verification_status: a.verificationStatus,
      status: a.status,
      verified_at: a.verifiedAt,
      created_at: a.createdAt,
    }));

    return sendSuccess(res, 'Connected accounts retrieved', { accounts: normalized });
  } catch (error) {
    return sendError(res, 'Failed to fetch connected accounts.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * GET /api/accounts/:accountId
 * Return details for one account.
 * Enforces merchant isolation.
 */
router.get('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    return sendSuccess(res, 'Account details retrieved', {
      account_id: account.id,
      phone_number: account.phoneNumber,
      upi_id: account.upiId,
      email: account.email,
      verification_status: account.verificationStatus,
      status: account.status,
      verified_at: account.verifiedAt,
      created_at: account.createdAt,
    });
  } catch (error) {
    return sendError(res, 'Failed to fetch account details.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * POST /api/accounts/:accountId/verify
 * Completes account verification flow.
 */
router.post('/:accountId/verify', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    const verified = await accountService.verify(accountId, req.merchant.id);

    return sendSuccess(res, 'Account successfully verified.', {
      account_id: verified.id,
      verification_status: verified.verificationStatus,
      verified_at: verified.verifiedAt,
    });
  } catch (error) {
    return sendError(res, 'Failed to verify account.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * POST /api/accounts/:accountId/activate
 * Activates this account for checkout.
 * Rules:
 * - Account must be verified before activation.
 * - Only ONE account can be active.
 * - Activating one account automatically deactivates the previously active account.
 */
router.post('/:accountId/activate', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    // Rule: Account must be verified before activation
    if (account.verificationStatus !== 'verified') {
      return sendError(
        res,
        'Cannot activate an unverified account. Please complete verification first.',
        ErrorCodes.ACCOUNT_NOT_VERIFIED,
        400
      );
    }

    const activated = await accountService.activate(accountId, req.merchant.id);

    return sendSuccess(res, 'Account activated for checkout. Any previously active account has been deactivated.', {
      account_id: activated.id,
      status: activated.status,
      verification_status: activated.verificationStatus,
    });
  } catch (error) {
    return sendError(res, 'Failed to activate account.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * POST /api/accounts/:accountId/deactivate
 * Deactivates this account.
 */
router.post('/:accountId/deactivate', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    const deactivated = await accountService.deactivate(accountId, req.merchant.id);

    return sendSuccess(res, 'Account deactivated.', {
      account_id: deactivated.id,
      status: deactivated.status,
    });
  } catch (error) {
    return sendError(res, 'Failed to deactivate account.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * DELETE /api/accounts/:accountId
 * Deletes a connected account.
 */
router.delete('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const deleted = await accountService.delete(accountId, req.merchant.id);

    if (!deleted) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    return sendSuccess(res, 'Account deleted successfully.', { account_id: accountId });
  } catch (error) {
    return sendError(res, 'Failed to delete account.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * POST /api/accounts/:accountId/sync
 * Starts synchronization for a connected account.
 */
router.post('/:accountId/sync', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    const mockEmails = req.body.mock_emails || null;
    const syncResult = await syncTransactions(accountId, mockEmails);

    return sendSuccess(res, 'Account transaction synchronization completed.', {
      account_id: accountId,
      synced_transactions: syncResult.syncedCount,
      matched_orders: syncResult.matchedCount,
    });
  } catch (error) {
    return sendError(res, error.message || 'Synchronization failed.', ErrorCodes.GMAIL_SYNC_FAILED, 500);
  }
});

/**
 * GET /api/accounts/:accountId/transactions
 * Returns normalized transaction records for the account.
 */
router.get('/:accountId/transactions', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountService.findByIdAndMerchant(accountId, req.merchant.id);

    if (!account) {
      return sendError(res, 'Account not found.', ErrorCodes.ACCOUNT_NOT_FOUND, 404);
    }

    const transactions = await transactionService.listByAccount(accountId, req.merchant.id);

    const normalized = transactions.map((t) => ({
      id: t.id,
      account_id: t.accountId,
      sender: t.sender,
      amount: t.amount,
      reference: t.reference,
      utr: t.utr,
      purpose: t.purpose,
      transaction_date: t.transactionDate,
      received_at: t.receivedAt,
      source_message_id: t.sourceMessageId,
      created_at: t.createdAt,
    }));

    return sendSuccess(res, 'Transactions retrieved', { transactions: normalized });
  } catch (error) {
    return sendError(res, 'Failed to fetch transactions.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

module.exports = router;
