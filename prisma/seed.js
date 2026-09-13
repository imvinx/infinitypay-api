/**
 * InfinityPay API - Development Seed Script
 * Generates initial demo merchant and API key for local testing.
 */

const { merchantService, apiKeyService, accountService } = require('../lib/db');
const { generateApiKey } = require('../lib/crypto');

async function seed() {
  console.log('Seeding InfinityPay test environment...');

  // 1. Create or retrieve demo merchant
  let merchant = await merchantService.findByEmail('demo@infinitypay.test');
  if (!merchant) {
    merchant = await merchantService.create({
      name: 'Acme Store',
      email: 'demo@infinitypay.test',
    });
    console.log(`Created Merchant: ${merchant.name} (${merchant.id})`);
  }

  // 2. Generate Demo API Key
  const { apiKey, keyPrefix, keyHash, keyId } = generateApiKey();
  await apiKeyService.create({
    merchantId: merchant.id,
    name: 'Demo Development Key',
    keyHash,
    keyPrefix,
    keyId,
  });

  // 3. Create a verified and active connected payment account
  const account = await accountService.create({
    merchantId: merchant.id,
    phoneNumber: '9876543210',
    upiId: 'acmestore@okhdfcbank',
    email: 'payments@acmestore.test',
  });

  await accountService.verify(account.id, merchant.id);
  await accountService.activate(account.id, merchant.id);

  console.log(`
==================================================================
  INFINITYPAY SEED COMPLETED
==================================================================
  Merchant ID   : ${merchant.id}
  Merchant Email: ${merchant.email}
  API Key       : ${apiKey}
  Account ID    : ${account.id}
  UPI ID        : ${account.upiId}
  Account Status: active (verified)
==================================================================
  Use this API key in headers:
  X-InfinityPay-Key: ${apiKey}
==================================================================
  `);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
