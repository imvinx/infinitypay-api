/**
 * InfinityPay API - Test Fixtures & Setup
 */

process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';

const createApp = require('../lib/app');
const { resetMemoryDatabase, merchantService, apiKeyService, accountService } = require('../lib/db');
const { generateApiKey } = require('../lib/crypto');
const { resetRateLimitStore } = require('../lib/rate-limiter');

const app = createApp();

/**
 * Setup a clean merchant with API key and optionally an active verified account
 */
async function setupTestMerchant(options = {}) {
  const email = options.email || `merchant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const name = options.name || 'Test Merchant Store';

  const merchant = await merchantService.create({ name, email });
  const { apiKey, keyPrefix, keyHash, keyId } = generateApiKey();

  await apiKeyService.create({
    merchantId: merchant.id,
    name: 'Test Key',
    keyHash,
    keyPrefix,
    keyId,
  });

  let activeAccount = null;
  if (options.withActiveAccount) {
    activeAccount = await accountService.create({
      merchantId: merchant.id,
      phoneNumber: '9876543210',
      upiId: 'testmerchant@okhdfcbank',
      email: email,
    });
    await accountService.verify(activeAccount.id, merchant.id);
    await accountService.activate(activeAccount.id, merchant.id);
  }

  return {
    merchant,
    apiKey,
    keyId,
    activeAccount,
  };
}

module.exports = {
  app,
  setupTestMerchant,
  resetMemoryDatabase,
  resetRateLimitStore,
};
