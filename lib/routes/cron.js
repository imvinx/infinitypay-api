/**
 * InfinityPay API - Scheduled Cron Synchronization Route
 * Automatically scans active verified payment accounts, syncs transactions,
 * and triggers payment matching.
 */

const express = require('express');
const router = express.Router();
const { sendSuccess, sendError, ErrorCodes } = require('../responses');
const { accountService } = require('../db');
const { syncTransactions } = require('../gmail');
const config = require('../config');

/**
 * Middleware: Verify cron authorization
 * Allows Vercel cron headers or CRON_SECRET token
 */
function verifyCronAuth(req, res, next) {
  // If running in development or test, allow execution
  if (config.isTest) return next();

  const authHeader = req.headers['authorization'];
  const token = req.query.secret || (authHeader && authHeader.replace('Bearer ', '').trim());
  const vercelCronHeader = req.headers['x-vercel-cron'];

  if (vercelCronHeader || (token && token === config.cronSecret)) {
    return next();
  }

  return sendError(res, 'Unauthorized cron trigger.', ErrorCodes.UNAUTHORIZED, 401);
}

/**
 * Handler for scheduled synchronization
 */
async function handleSync(req, res) {
  try {
    const activeAccounts = await accountService.listAllActiveVerifiedAccounts();

    let totalSynced = 0;
    let totalMatched = 0;
    const results = [];

    for (const account of activeAccounts) {
      try {
        const syncResult = await syncTransactions(account.id);
        totalSynced += syncResult.syncedCount;
        totalMatched += syncResult.matchedCount;
        results.push({
          account_id: account.id,
          synced: syncResult.syncedCount,
          matched: syncResult.matchedCount,
          status: 'success',
        });
      } catch (err) {
        results.push({
          account_id: account.id,
          status: 'failed',
          error: err.message,
        });
      }
    }

    return sendSuccess(res, 'Periodic synchronization completed', {
      processed_accounts: activeAccounts.length,
      total_synced_transactions: totalSynced,
      total_matched_orders: totalMatched,
      details: results,
    });
  } catch (error) {
    return sendError(res, error.message || 'Scheduled synchronization error', ErrorCodes.INTERNAL_ERROR, 500);
  }
}

// Support both GET and POST for Vercel Cron
router.get('/sync', verifyCronAuth, handleSync);
router.post('/sync', verifyCronAuth, handleSync);

module.exports = router;
