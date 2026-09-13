/**
 * InfinityPay API - Database & Repository Layer
 * Manages Prisma Client connection pooling for Vercel serverless environments
 * and provides unified data services with merchant isolation enforcement.
 */

const { PrismaClient } = require('@prisma/client');
const config = require('./config');
const crypto = require('crypto');

// Prisma client singleton for serverless / lambda hot reload
let prismaInstance = null;

function getPrismaClient() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: config.isProduction ? ['error', 'warn'] : ['error', 'warn'],
    });
  }
  return prismaInstance;
}

// In-memory fallback store for unit tests or standalone execution without live Postgres
const memoryStore = {
  merchants: new Map(),
  apiKeys: new Map(),
  accounts: new Map(),
  orders: new Map(),
  transactions: new Map(),
  gmailConnections: new Map(),
  syncLogs: [],
};

// Determine whether to use memory store (test mode or no valid postgres connection string)
function isMemoryMode() {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.USE_MEMORY_DB === 'true' ||
    !config.databaseUrl ||
    config.databaseUrl.includes('USER:PASSWORD')
  );
}

// ==============================================================================
// 1. MERCHANT SERVICE
// ==============================================================================
const merchantService = {
  async create({ name, email }) {
    if (isMemoryMode()) {
      const id = `mer_${crypto.randomBytes(8).toString('hex')}`;
      const merchant = {
        id,
        name,
        email: email.toLowerCase(),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore.merchants.set(id, merchant);
      return merchant;
    }
    const prisma = getPrismaClient();
    return prisma.merchant.create({
      data: { name, email: email.toLowerCase() },
    });
  },

  async findById(id) {
    if (isMemoryMode()) {
      return memoryStore.merchants.get(id) || null;
    }
    const prisma = getPrismaClient();
    return prisma.merchant.findUnique({ where: { id } });
  },

  async findByEmail(email) {
    const cleanEmail = email.toLowerCase();
    if (isMemoryMode()) {
      for (const m of memoryStore.merchants.values()) {
        if (m.email === cleanEmail) return m;
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.merchant.findUnique({ where: { email: cleanEmail } });
  },
};

// ==============================================================================
// 2. API KEY SERVICE
// ==============================================================================
const apiKeyService = {
  async create({ merchantId, name = 'Production Key', keyHash, keyPrefix, keyId }) {
    const id = keyId || `key_${crypto.randomBytes(8).toString('hex')}`;
    if (isMemoryMode()) {
      const keyRecord = {
        id,
        merchantId,
        name,
        keyHash,
        keyPrefix,
        status: 'active',
        lastUsedAt: null,
        createdAt: new Date(),
        revokedAt: null,
      };
      memoryStore.apiKeys.set(id, keyRecord);
      return keyRecord;
    }
    const prisma = getPrismaClient();
    return prisma.apiKey.create({
      data: {
        id,
        merchantId,
        name,
        keyHash,
        keyPrefix,
        status: 'active',
      },
    });
  },

  async findActiveByHash(keyHash) {
    if (isMemoryMode()) {
      for (const k of memoryStore.apiKeys.values()) {
        if (k.keyHash === keyHash && k.status === 'active') {
          const merchant = memoryStore.merchants.get(k.merchantId);
          return { ...k, merchant };
        }
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.apiKey.findFirst({
      where: { keyHash, status: 'active' },
      include: { merchant: true },
    });
  },

  async listByMerchant(merchantId) {
    if (isMemoryMode()) {
      const keys = [];
      for (const k of memoryStore.apiKeys.values()) {
        if (k.merchantId === merchantId) {
          // Metadata only - never leak hashes or private secrets
          keys.push({
            id: k.id,
            name: k.name,
            key_prefix: k.keyPrefix,
            status: k.status,
            last_used_at: k.lastUsedAt,
            created_at: k.createdAt,
            revoked_at: k.revokedAt,
          });
        }
      }
      return keys.sort((a, b) => b.created_at - a.created_at);
    }
    const prisma = getPrismaClient();
    const keys = await prisma.apiKey.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.keyPrefix,
      status: k.status,
      last_used_at: k.lastUsedAt,
      created_at: k.createdAt,
      revoked_at: k.revokedAt,
    }));
  },

  async revoke(keyId, merchantId) {
    if (isMemoryMode()) {
      const key = memoryStore.apiKeys.get(keyId);
      if (!key || key.merchantId !== merchantId) return null;
      key.status = 'revoked';
      key.revokedAt = new Date();
      return key;
    }
    const prisma = getPrismaClient();
    return prisma.apiKey.updateMany({
      where: { id: keyId, merchantId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  },

  async touchLastUsed(keyId) {
    const now = new Date();
    if (isMemoryMode()) {
      const key = memoryStore.apiKeys.get(keyId);
      if (key) key.lastUsedAt = now;
      return;
    }
    const prisma = getPrismaClient();
    await prisma.apiKey
      .update({
        where: { id: keyId },
        data: { lastUsedAt: now },
      })
      .catch(() => {});
  },
};

// ==============================================================================
// 3. PAYMENT ACCOUNT SERVICE
// ==============================================================================
const accountService = {
  async countByMerchant(merchantId) {
    if (isMemoryMode()) {
      let count = 0;
      for (const a of memoryStore.accounts.values()) {
        if (a.merchantId === merchantId) count++;
      }
      return count;
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.count({ where: { merchantId } });
  },

  async create({ merchantId, phoneNumber, upiId, email }) {
    const id = `acc_${crypto.randomBytes(8).toString('hex')}`;
    if (isMemoryMode()) {
      const account = {
        id,
        merchantId,
        phoneNumber,
        upiId: upiId.toLowerCase(),
        email: email.toLowerCase(),
        verificationStatus: 'pending',
        status: 'inactive',
        verifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore.accounts.set(id, account);
      return account;
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.create({
      data: {
        id,
        merchantId,
        phoneNumber,
        upiId: upiId.toLowerCase(),
        email: email.toLowerCase(),
        verificationStatus: 'pending',
        status: 'inactive',
      },
    });
  },

  async listByMerchant(merchantId) {
    if (isMemoryMode()) {
      const accounts = [];
      for (const a of memoryStore.accounts.values()) {
        if (a.merchantId === merchantId) accounts.push({ ...a });
      }
      return accounts.sort((a, b) => b.createdAt - a.createdAt);
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findByIdAndMerchant(accountId, merchantId) {
    if (isMemoryMode()) {
      const a = memoryStore.accounts.get(accountId);
      if (!a || a.merchantId !== merchantId) return null;
      return { ...a };
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.findFirst({
      where: { id: accountId, merchantId },
    });
  },

  async findById(accountId) {
    if (isMemoryMode()) {
      return memoryStore.accounts.get(accountId) || null;
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.findUnique({ where: { id: accountId } });
  },

  async getActiveAccountForMerchant(merchantId) {
    if (isMemoryMode()) {
      for (const a of memoryStore.accounts.values()) {
        if (a.merchantId === merchantId && a.status === 'active' && a.verificationStatus === 'verified') {
          return { ...a };
        }
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.findFirst({
      where: {
        merchantId,
        status: 'active',
        verificationStatus: 'verified',
      },
    });
  },

  async verify(accountId, merchantId) {
    const verifiedAt = new Date();
    if (isMemoryMode()) {
      const a = memoryStore.accounts.get(accountId);
      if (!a || a.merchantId !== merchantId) return null;
      a.verificationStatus = 'verified';
      a.verifiedAt = verifiedAt;
      a.updatedAt = new Date();
      return { ...a };
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.update({
      where: { id: accountId },
      data: {
        verificationStatus: 'verified',
        verifiedAt,
      },
    });
  },

  async activate(accountId, merchantId) {
    const now = new Date();
    if (isMemoryMode()) {
      const target = memoryStore.accounts.get(accountId);
      if (!target || target.merchantId !== merchantId) return null;
      if (target.verificationStatus !== 'verified') return false; // not verified

      // Deactivate all accounts for this merchant
      for (const a of memoryStore.accounts.values()) {
        if (a.merchantId === merchantId) {
          a.status = 'inactive';
          a.updatedAt = now;
        }
      }

      // Activate target account
      target.status = 'active';
      target.updatedAt = now;
      return { ...target };
    }

    const prisma = getPrismaClient();
    return prisma.$transaction(async (tx) => {
      // Deactivate any currently active accounts for merchant
      await tx.paymentAccount.updateMany({
        where: { merchantId, status: 'active' },
        data: { status: 'inactive' },
      });

      // Activate selected account
      return tx.paymentAccount.update({
        where: { id: accountId },
        data: { status: 'active' },
      });
    });
  },

  async deactivate(accountId, merchantId) {
    if (isMemoryMode()) {
      const target = memoryStore.accounts.get(accountId);
      if (!target || target.merchantId !== merchantId) return null;
      target.status = 'inactive';
      target.updatedAt = new Date();
      return { ...target };
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.update({
      where: { id: accountId },
      data: { status: 'inactive' },
    });
  },

  async delete(accountId, merchantId) {
    if (isMemoryMode()) {
      const target = memoryStore.accounts.get(accountId);
      if (!target || target.merchantId !== merchantId) return false;
      memoryStore.accounts.delete(accountId);
      return true;
    }
    const prisma = getPrismaClient();
    const res = await prisma.paymentAccount.deleteMany({
      where: { id: accountId, merchantId },
    });
    return res.count > 0;
  },

  async listAllActiveVerifiedAccounts() {
    if (isMemoryMode()) {
      const list = [];
      for (const a of memoryStore.accounts.values()) {
        if (a.status === 'active' && a.verificationStatus === 'verified') {
          list.push({ ...a });
        }
      }
      return list;
    }
    const prisma = getPrismaClient();
    return prisma.paymentAccount.findMany({
      where: { status: 'active', verificationStatus: 'verified' },
    });
  },
};

// ==============================================================================
// 4. PAYMENT ORDER SERVICE
// ==============================================================================
const orderService = {
  async create({
    orderId,
    merchantId,
    accountId,
    amount,
    currency = 'INR',
    title = null,
    customerMobile = null,
    redirectUrl = null,
    expiresAt,
  }) {
    const id = `ord_${crypto.randomBytes(8).toString('hex')}`;
    const orderData = {
      id,
      orderId,
      merchantId,
      accountId,
      amount,
      currency,
      title,
      customerMobile,
      redirectUrl,
      status: 'pending',
      matchedTransactionId: null,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (isMemoryMode()) {
      memoryStore.orders.set(orderId, orderData);
      return { ...orderData };
    }

    const prisma = getPrismaClient();
    return prisma.paymentOrder.create({
      data: {
        id,
        orderId,
        merchantId,
        accountId,
        amount,
        currency,
        title,
        customerMobile,
        redirectUrl,
        status: 'pending',
        expiresAt,
      },
    });
  },

  async findByOrderId(orderId) {
    if (isMemoryMode()) {
      return memoryStore.orders.get(orderId) || null;
    }
    const prisma = getPrismaClient();
    return prisma.paymentOrder.findUnique({
      where: { orderId },
      include: { account: true, merchant: true },
    });
  },

  async findByOrderIdAndMerchant(orderId, merchantId) {
    if (isMemoryMode()) {
      const o = memoryStore.orders.get(orderId);
      if (!o || o.merchantId !== merchantId) return null;
      return { ...o };
    }
    const prisma = getPrismaClient();
    return prisma.paymentOrder.findFirst({
      where: { orderId, merchantId },
    });
  },

  async findPendingByAccountAndAmount(accountId, amount) {
    if (isMemoryMode()) {
      const now = new Date();
      const results = [];
      for (const o of memoryStore.orders.values()) {
        if (
          o.accountId === accountId &&
          o.status === 'pending' &&
          Math.abs(o.amount - amount) < 0.001 &&
          o.expiresAt > now
        ) {
          results.push({ ...o });
        }
      }
      return results;
    }
    const prisma = getPrismaClient();
    return prisma.paymentOrder.findMany({
      where: {
        accountId,
        status: 'pending',
        amount,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async markOrderSuccess(orderId, transactionId) {
    const now = new Date();
    if (isMemoryMode()) {
      const order = memoryStore.orders.get(orderId);
      if (order && order.status === 'pending') {
        order.status = 'success';
        order.matchedTransactionId = transactionId;
        order.updatedAt = now;
        return { ...order };
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.paymentOrder.update({
      where: { orderId },
      data: {
        status: 'success',
        matchedTransactionId: transactionId,
      },
    });
  },

  async markOrderExpired(orderId) {
    if (isMemoryMode()) {
      const order = memoryStore.orders.get(orderId);
      if (order && order.status === 'pending') {
        order.status = 'expired';
        order.updatedAt = new Date();
        return { ...order };
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.paymentOrder.update({
      where: { orderId },
      data: { status: 'expired' },
    });
  },
};

// ==============================================================================
// 5. TRANSACTION SERVICE
// ==============================================================================
const transactionService = {
  async create({
    accountId,
    merchantId,
    sender,
    amount,
    currency = 'INR',
    reference,
    utr,
    purpose,
    sourceMessageId,
    rawEmailSnippet,
    transactionDate,
  }) {
    // Prevent duplicate source messages
    if (sourceMessageId) {
      const existing = await this.findBySourceMessageId(sourceMessageId, accountId);
      if (existing) {
        return { duplicate: true, transaction: existing };
      }
    }

    const id = `tx_${crypto.randomBytes(8).toString('hex')}`;
    const txData = {
      id,
      accountId,
      merchantId,
      sender: sender || null,
      amount,
      currency,
      reference: reference || null,
      utr: utr || null,
      purpose: purpose || null,
      sourceMessageId: sourceMessageId || null,
      rawEmailSnippet: rawEmailSnippet || null,
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      receivedAt: new Date(),
      matchedOrderId: null,
      createdAt: new Date(),
    };

    if (isMemoryMode()) {
      memoryStore.transactions.set(id, txData);
      return { duplicate: false, transaction: { ...txData } };
    }

    const prisma = getPrismaClient();
    const created = await prisma.transaction.create({
      data: txData,
    });
    return { duplicate: false, transaction: created };
  },

  async findBySourceMessageId(sourceMessageId, accountId) {
    if (!sourceMessageId) return null;
    if (isMemoryMode()) {
      for (const t of memoryStore.transactions.values()) {
        if (t.sourceMessageId === sourceMessageId && (!accountId || t.accountId === accountId)) {
          return { ...t };
        }
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.transaction.findFirst({
      where: { sourceMessageId, ...(accountId ? { accountId } : {}) },
    });
  },

  async listByAccount(accountId, merchantId) {
    if (isMemoryMode()) {
      const list = [];
      for (const t of memoryStore.transactions.values()) {
        if (t.accountId === accountId && t.merchantId === merchantId) {
          list.push({ ...t });
        }
      }
      return list.sort((a, b) => b.transactionDate - a.transactionDate);
    }
    const prisma = getPrismaClient();
    return prisma.transaction.findMany({
      where: { accountId, merchantId },
      orderBy: { transactionDate: 'desc' },
    });
  },

  async linkToOrder(transactionId, orderId) {
    if (isMemoryMode()) {
      const tx = memoryStore.transactions.get(transactionId);
      if (tx) {
        tx.matchedOrderId = orderId;
        return { ...tx };
      }
      return null;
    }
    const prisma = getPrismaClient();
    return prisma.transaction.update({
      where: { id: transactionId },
      data: { matchedOrderId: orderId },
    });
  },

  async getById(transactionId) {
    if (isMemoryMode()) {
      return memoryStore.transactions.get(transactionId) || null;
    }
    const prisma = getPrismaClient();
    return prisma.transaction.findUnique({ where: { id: transactionId } });
  },
};

// ==============================================================================
// 6. GMAIL CONNECTION SERVICE
// ==============================================================================
const gmailConnectionService = {
  async upsert(accountId, data) {
    const id = `gcon_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date();
    if (isMemoryMode()) {
      const record = {
        id,
        accountId,
        email: data.email,
        authType: data.authType || 'oauth2',
        encryptedCredentials: data.encryptedCredentials,
        tokenExpiry: data.tokenExpiry || null,
        lastSyncedAt: null,
        syncStatus: 'connected',
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      memoryStore.gmailConnections.set(accountId, record);
      return record;
    }
    const prisma = getPrismaClient();
    return prisma.gmailConnection.upsert({
      where: { accountId },
      create: {
        id,
        accountId,
        email: data.email,
        authType: data.authType || 'oauth2',
        encryptedCredentials: data.encryptedCredentials,
        tokenExpiry: data.tokenExpiry || null,
        syncStatus: 'connected',
      },
      update: {
        email: data.email,
        authType: data.authType || 'oauth2',
        encryptedCredentials: data.encryptedCredentials,
        tokenExpiry: data.tokenExpiry || null,
        syncStatus: 'connected',
        lastError: null,
      },
    });
  },

  async findByAccountId(accountId) {
    if (isMemoryMode()) {
      return memoryStore.gmailConnections.get(accountId) || null;
    }
    const prisma = getPrismaClient();
    return prisma.gmailConnection.findUnique({ where: { accountId } });
  },

  async updateSyncStatus(accountId, status, lastError = null) {
    const now = new Date();
    if (isMemoryMode()) {
      const c = memoryStore.gmailConnections.get(accountId);
      if (c) {
        c.syncStatus = status;
        c.lastSyncedAt = now;
        c.lastError = lastError;
      }
      return;
    }
    const prisma = getPrismaClient();
    await prisma.gmailConnection
      .update({
        where: { accountId },
        data: { syncStatus: status, lastSyncedAt: now, lastError },
      })
      .catch(() => {});
  },
};

// ==============================================================================
// 7. SYNC LOG SERVICE
// ==============================================================================
const syncLogService = {
  async create({ accountId, status, syncedCount = 0, matchedCount = 0, errorMessage = null }) {
    const id = `slog_${crypto.randomBytes(8).toString('hex')}`;
    const logData = {
      id,
      accountId,
      status,
      syncedCount,
      matchedCount,
      errorMessage,
      createdAt: new Date(),
    };
    if (isMemoryMode()) {
      memoryStore.syncLogs.push(logData);
      return logData;
    }
    const prisma = getPrismaClient();
    return prisma.syncLog.create({ data: logData });
  },
};

// Helper for testing to clear in-memory database
function resetMemoryDatabase() {
  memoryStore.merchants.clear();
  memoryStore.apiKeys.clear();
  memoryStore.accounts.clear();
  memoryStore.orders.clear();
  memoryStore.transactions.clear();
  memoryStore.gmailConnections.clear();
  memoryStore.syncLogs = [];
}

module.exports = {
  getPrismaClient,
  isMemoryMode,
  resetMemoryDatabase,
  merchantService,
  apiKeyService,
  accountService,
  orderService,
  transactionService,
  gmailConnectionService,
  syncLogService,
};
