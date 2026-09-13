/**
 * InfinityPay API - Cryptography & Encryption Module
 * Handles API key hashing (SHA-256) and AES-256-GCM authenticated encryption for secrets at rest.
 */
const crypto = require('crypto');
const config = require('./config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Get 32-byte encryption key buffer from config
 */
function getEncryptionKeyBuffer() {
  let keyHex = config.encryptionKey;
  if (!keyHex || keyHex.length < 64) {
    // Derive deterministic 32-byte key from apiSecret fallback
    return crypto.createHash('sha256').update(config.apiSecret).digest();
  }
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Output format: iv:authTag:ciphertext (hex-encoded)
 * @param {string} plaintext
 * @returns {string} encrypted string
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM ciphertext
 * @param {string} encryptedPayload
 * @returns {string} plaintext
 */
function decrypt(encryptedPayload) {
  if (!encryptedPayload) return null;
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKeyBuffer();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate a cryptographically secure random API key
 * Format: ip_live_<32 random hex characters>
 * @returns {{ apiKey: string, keyPrefix: string, keyHash: string, keyId: string }}
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  const apiKey = `ip_live_${randomBytes}`;
  const keyPrefix = apiKey.slice(0, 16); // e.g. "ip_live_a1b2c3d4"
  const keyHash = hashApiKey(apiKey);
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;

  return {
    apiKey,
    keyPrefix,
    keyHash,
    keyId,
  };
}

/**
 * Compute SHA-256 hash of an API key for safe database storage and lookup
 * @param {string} apiKey
 * @returns {string} hex hash
 */
function hashApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return '';
  return crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
}

/**
 * Generate an internal unique Order ID in the format "IPYYYYMMDDXXXXXX"
 * @returns {string} orderId
 */
function generateOrderId() {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars

  return `IP${year}${month}${day}${randomSuffix}`;
}

module.exports = {
  encrypt,
  decrypt,
  generateApiKey,
  hashApiKey,
  generateOrderId,
};
