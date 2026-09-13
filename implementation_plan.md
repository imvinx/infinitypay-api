# Implementation Plan: InfinityPay API Platform

InfinityPay is an independent, production-grade payment gateway REST API backend designed for high security, seamless Vercel serverless deployment, and robust server-side payment verification.

## User Review Required

> [!IMPORTANT]
> - **Zero Frontend Code**: As instructed, no frontend will be built in this task.
> - **Dual-Runtime Serverless Design**: The architecture will be built with Express modularity, exportable as standard Vercel serverless functions (`api/index.js` + route controllers) and runnable locally via `npm run dev` (`server.js`).
> - **Database Strategy**: Uses Prisma ORM with PostgreSQL provider. For automated tests and environments without an external live PostgreSQL URL, an abstracted database layer provides zero-dependency automated unit/integration test execution while supporting real PostgreSQL in staging/production.
> - **Vercel Cron Integration**: Includes native `vercel.json` cron configuration for periodic automated transaction synchronization (`/api/cron/sync`).

---

## Proposed Project Structure

```
c:\Users\V I N X\Desktop\InfinityPay API/
├── api/
│   ├── index.js                  # Main Vercel serverless entrypoint
│   └── cron/
│       └── sync.js               # Scheduled sync endpoint for Vercel Cron
├── lib/
│   ├── config.js                 # Environment configuration & constants
│   ├── db.js                     # Prisma client wrapper & database service
│   ├── auth.js                   # API key generation, hashing (SHA-256), auth middleware
│   ├── crypto.js                 # AES-256-GCM encryption for credentials at rest
│   ├── rate-limiter.js           # API-key & IP sliding-window rate limiter (HTTP 429)
│   ├── validation.js             # Input validation & sanitization (amount, mobile, URLs)
│   ├── responses.js              # Standardized JSON response helpers (success/error)
│   ├── gmail.js                  # Gmail transaction sync & email parsing module
│   ├── payment-matcher.js        # Transaction-to-order matching & verification engine
│   └── routes/
│       ├── health.js             # GET /api/health
│       ├── developer.js          # /api/developer/keys, create-order, order-status
│       ├── accounts.js           # /api/accounts CRUD, verify, activate, deactivate, sync
│       ├── checkout.js           # Public checkout details for payment URL
│       └── cron.js               # Scheduled sync runner
├── prisma/
│   ├── schema.prisma             # Full PostgreSQL Prisma schema
│   └── seed.js                   # Database seed script for development
├── tests/
│   ├── setup.js                  # Test fixtures & mock data
│   ├── health.test.js            # Health check test
│   ├── auth.test.js              # API key creation, hashing, validation, revocation
│   ├── accounts.test.js          # Account CRUD, limit of 3, verify, activation rules
│   ├── orders.test.js            # Create order, validation, status, merchant isolation
│   ├── payment-matcher.test.js   # Matching engine, idempotency, duplicate protection
│   └── rate-limiter.test.js      # Rate limiting threshold & 429 response
├── server.js                     # Local development Express server
├── vercel.json                   # Vercel deployment & cron config
├── package.json                  # Dependencies, test scripts, prisma commands
├── .env.example                  # Comprehensive environment variable template
├── .gitignore                    # Node, prisma, logs, env ignore
├── README.md                     # Comprehensive architecture, setup, deployment guide
└── API.md                        # Complete API reference documentation
```

---

## Proposed Changes

### Core Configuration & Infrastructure

#### [NEW] [package.json](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/package.json)
- Dependencies: `express`, `@prisma/client`, `cors`, `helmet`, `dotenv`
- DevDependencies: `prisma`, `jest` (or node test runner), `supertest`
- Scripts: `start`, `dev`, `test`, `prisma:generate`, `prisma:migrate`, `prisma:seed`

#### [NEW] [vercel.json](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/vercel.json)
- Rewrites routing `/api/*` to `api/index.js`
- Cron job configuration for `/api/cron/sync` (every 5 minutes)

#### [NEW] [.env.example](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/.env.example)
- Required variables: `DATABASE_URL`, `INFINITYPAY_API_SECRET`, `ENCRYPTION_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `PORT`, `NODE_ENV`.

---

### Database Layer (Prisma Schema)

#### [NEW] [prisma/schema.prisma](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/prisma/schema.prisma)
Models:
1. `Merchant`: `id`, `name`, `email`, `status`, `createdAt`, `updatedAt`
2. `ApiKey`: `id`, `merchantId`, `name`, `keyHash`, `keyPrefix`, `status`, `lastUsedAt`, `createdAt`, `revokedAt`
3. `PaymentAccount`: `id`, `merchantId`, `phoneNumber`, `upiId`, `email`, `verificationStatus`, `status`, `verifiedAt`, `createdAt`, `updatedAt`
4. `PaymentOrder`: `id`, `orderId` (unique `IPYYYYMMDDxxxxxx`), `merchantId`, `accountId`, `amount`, `currency`, `title`, `customerMobile`, `redirectUrl`, `status`, `matchedTransactionId`, `expiresAt`, `createdAt`, `updatedAt`
5. `Transaction`: `id`, `accountId`, `merchantId`, `sender`, `amount`, `currency`, `reference`, `utr`, `purpose`, `sourceMessageId` (unique per account), `rawEmailSnippet`, `transactionDate`, `receivedAt`, `matchedOrderId`, `createdAt`
6. `GmailConnection`: `id`, `accountId`, `email`, `authType`, `encryptedCredentials`, `tokenExpiry`, `lastSyncedAt`, `syncStatus`, `lastError`, `createdAt`, `updatedAt`
7. `SyncLog`: `id`, `accountId`, `status`, `syncedCount`, `matchedCount`, `errorMessage`, `createdAt`

Indexes on `merchantId`, `keyHash`, `accountId`, `orderId`, `reference`, `utr`, `transactionDate`, `status`.

---

### Library & Core Services

#### [NEW] [lib/responses.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/responses.js)
Standardized response formats:
- `sendSuccess(res, message, data, statusCode = 200)`
- `sendError(res, message, code, statusCode = 400, details = null)`

#### [NEW] [lib/crypto.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/crypto.js)
- AES-256-GCM authenticated encryption/decryption for credentials (e.g. Gmail app passwords, OAuth tokens) stored in database.

#### [NEW] [lib/auth.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/auth.js)
- `generateApiKey()`: returns `{ rawKey, keyId, keyPrefix, keyHash }`
- Hash algorithm: SHA-256 (`crypto.createHash('sha256')`)
- Middleware `authenticateApiKey`:
  - Inspects `X-InfinityPay-Key` or `Authorization: Bearer <key>`
  - Hashes input and finds active `ApiKey`
  - Attaches `req.merchant` and `req.apiKey`
  - Updates `lastUsedAt` asynchronously
  - Error codes: `MISSING_API_KEY`, `INVALID_API_KEY`

#### [NEW] [lib/rate-limiter.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/rate-limiter.js)
- Sliding window counter per API key (default 60 req/min, 1000 req/hr)
- Fallback by client IP for public endpoints
- Returns HTTP 429 with `RATE_LIMITED` code and `Retry-After` header.

#### [NEW] [lib/validation.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/validation.js)
- Strict amount validation (numeric, positive, reject currency signs like `₹` or `$`)
- Mobile number normalization (sanitize to 10 digits)
- URL validation for `redirect_url`

#### [NEW] [lib/gmail.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/gmail.js)
- Server-side Gmail integration:
  - `connectMailbox()`
  - `verifyMailbox()`
  - `syncTransactions()`
  - `parseTransactionEmail()` (parses UPI credit alerts, UTR numbers, amounts, senders)
  - `storeTransaction()` (guarantees idempotency via `sourceMessageId`)

#### [NEW] [lib/payment-matcher.js](file:///c:/Users/V%20I%20N%20X/Desktop/InfinityPay%20API/lib/payment-matcher.js)
- `verifyOrderPayment(orderId)`
- Matching engine:
  - Finds pending orders for account
  - Matches exact amount and time window
  - Reconciles UTR / reference / note
  - Prevents double matching: one transaction can only fulfill ONE order
  - Safe policy: leaves status pending if ambiguous

---

### API Route Endpoints

1. **Health**:
   - `GET /api/health` -> `{ success: true, service: "InfinityPay API", status: "online" }`
2. **Developer Keys**:
   - `POST /api/developer/keys` -> Generates key, returns plaintext key ONLY on creation
   - `GET /api/developer/keys` -> Returns key metadata (prefix, created_at, status, last_used)
   - `DELETE /api/developer/keys/:keyId` -> Revokes key
3. **Connected Payment Accounts**:
   - `POST /api/accounts` -> Max 3 accounts per merchant, initial state pending/inactive
   - `GET /api/accounts` -> Lists merchant's connected accounts
   - `GET /api/accounts/:accountId` -> Account details (merchant isolation enforced)
   - `POST /api/accounts/:accountId/verify` -> Completes verification
   - `POST /api/accounts/:accountId/activate` -> Activates account (must be verified, deactivates previous active account)
   - `POST /api/accounts/:accountId/deactivate` -> Deactivates account
   - `DELETE /api/accounts/:accountId` -> Deletes account
   - `POST /api/accounts/:accountId/sync` -> Triggers sync for account
   - `GET /api/accounts/:accountId/transactions` -> Returns normalized transactions
4. **Orders & Checkout**:
   - `POST /api/developer/create-order` -> Generates `order_id` ("IP..."), calculates dynamic `payment_url`, validates amount & mobile
   - `GET /api/developer/order-status/:orderId` -> Returns status (pending, success, failed, expired)
   - `GET /api/checkout/:orderId` -> Safe public checkout info for payment URL
5. **Automation / Cron**:
   - `POST /api/cron/sync` -> Periodic sync endpoint protected by `CRON_SECRET`

---

## Verification Plan

### Automated Tests
Run automated test suite:
```bash
npm test
```
Tests will verify:
1. `GET /api/health` returns status online
2. `POST /api/developer/keys` creates key and returns key only once
3. Invalid or missing API key returns `INVALID_API_KEY` / `MISSING_API_KEY` (401)
4. Account creation initializes `pending` & `inactive`
5. Maximum 3 accounts enforced (`ACCOUNT_LIMIT_REACHED`)
6. Account activation requires verification (`ACCOUNT_NOT_VERIFIED`)
7. Activating an account deactivates previously active account (`only one active account at a time`)
8. `POST /api/developer/create-order` validates amount and mobile number properly
9. `GET /api/developer/order-status/:orderId` returns order status and enforces merchant isolation
10. Transaction ingestion enforces idempotency (duplicate source message id rejected)
11. Payment matching transitions pending order to `success` when matching transaction arrives
12. One transaction cannot match multiple orders
13. Rate limiter triggers HTTP 429 when threshold exceeded

### Manual Verification
- Start local server with `node server.js`
- Test health and endpoints via curl / HTTP requests
- Verify dynamic `payment_url` generation
