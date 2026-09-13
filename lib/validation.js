/**
 * InfinityPay API - Input Validation and Sanitization Module
 * Rejects malformed currency strings, validates mobile numbers, and sanitizes payloads.
 */

/**
 * Validates a monetary amount.
 * Rules:
 * - Must be provided (required)
 * - Must be a numeric number (or strictly parseable as a pure positive number)
 * - Must NOT be a formatted currency string (e.g. "₹500", "$10", "1,000")
 * - Must be strictly greater than 0
 * - Rounded/normalized to 2 decimal places
 *
 * @param {any} amount
 * @returns {{ valid: boolean, amount?: number, error?: string }}
 */
function validateAmount(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return { valid: false, error: 'Amount is required.' };
  }

  // Reject formatted strings with currency symbols, commas, or spaces
  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    // Only allow pure digits with optional single decimal dot
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Amount must be a pure positive numeric value. Formatted currency strings (e.g., ₹, $, commas) are rejected.',
      };
    }
  }

  const num = Number(amount);
  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: 'Amount must be a valid finite number.' };
  }

  if (num <= 0) {
    return { valid: false, error: 'Amount must be greater than zero.' };
  }

  if (num > 10000000) {
    return { valid: false, error: 'Amount exceeds maximum allowable transaction limit.' };
  }

  // Normalize to 2 decimal places
  const normalized = Math.round(num * 100) / 100;
  return { valid: true, amount: normalized };
}

/**
 * Validates and sanitizes a customer mobile number.
 * Removes spaces, dashes, parentheses, and leading "+91" / "0" prefix for standard 10-digit format.
 *
 * @param {any} mobile
 * @returns {{ valid: boolean, mobile?: string, error?: string }}
 */
function validateMobile(mobile) {
  if (!mobile) {
    return { valid: true, mobile: null };
  }

  if (typeof mobile !== 'string' && typeof mobile !== 'number') {
    return { valid: false, error: 'Customer mobile must be a string or number.' };
  }

  const rawStr = String(mobile).trim();
  // Strip all non-digit characters
  let digits = rawStr.replace(/\D/g, '');

  // Strip international country code if 12 digits starting with 91
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Indian standard mobile numbers are 10 digits starting with 6-9
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return {
      valid: false,
      error: 'Invalid mobile number. Must be a valid 10-digit mobile number.',
    };
  }

  return { valid: true, mobile: digits };
}

/**
 * Validates a UPI ID format (e.g. username@bank, user.name@okhdfcbank)
 * @param {string} upiId
 * @returns {{ valid: boolean, upiId?: string, error?: string }}
 */
function validateUpiId(upiId) {
  if (!upiId || typeof upiId !== 'string') {
    return { valid: false, error: 'UPI ID is required and must be a string.' };
  }

  const trimmed = upiId.trim().toLowerCase();
  // Standard UPI ID pattern: letters, numbers, dots, hyphens followed by '@' and bank handle
  const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  if (!upiRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid UPI ID format. Example: merchant@okhdfcbank' };
  }

  return { valid: true, upiId: trimmed };
}

/**
 * Validates an email address
 * @param {string} email
 * @returns {{ valid: boolean, email?: string, error?: string }}
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required.' };
  }

  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email address.' };
  }

  return { valid: true, email: trimmed };
}

/**
 * Validates a redirect URL
 * @param {string} url
 * @returns {{ valid: boolean, url?: string, error?: string }}
 */
function validateUrl(url) {
  if (!url) {
    return { valid: true, url: null };
  }

  if (typeof url !== 'string') {
    return { valid: false, error: 'Redirect URL must be a string.' };
  }

  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Redirect URL must use HTTP or HTTPS protocol.' };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

/**
 * Sanitize string input to prevent injection or control character issues
 * @param {string} str
 * @param {number} [maxLength=255]
 * @returns {string}
 */
function sanitizeString(str, maxLength = 255) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, maxLength);
}

module.exports = {
  validateAmount,
  validateMobile,
  validateUpiId,
  validateEmail,
  validateUrl,
  sanitizeString,
};
