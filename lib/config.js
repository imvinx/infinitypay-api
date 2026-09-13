/**
 * InfinityPay API - Central Configuration
 * Manages environment variables and runtime settings.
 */
require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: parseInt(process.env.PORT || '3000', 10),

  // Base URL (never hardcoded, dynamically fallback to localhost or env)
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Secrets & Cryptography
  apiSecret: process.env.INFINITYPAY_API_SECRET || 'infinitypay_dev_master_secret_32chars_min',
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 32-byte hex string
  cronSecret: process.env.CRON_SECRET || 'infinitypay_dev_cron_secret',

  // Gmail / Google OAuth
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || '',
  },

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['*'],

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
    maxPerMinute: parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW || '60', 10),
    maxPerHour: 1000,
  },

  // Business Constraints
  accounts: {
    maxPerMerchant: 3,
  },

  orders: {
    expiryMinutes: 15,
  },
};

module.exports = config;
