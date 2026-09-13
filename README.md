# InfinityPay API

> Production-ready, secure payment gateway REST API platform designed for seamless deployment on Vercel serverless functions with PostgreSQL and Prisma ORM.

---

## 1. Project Overview

**InfinityPay API** is an independent payment gateway backend designed for merchants to accept UPI and digital payments. It features:
- **Serverless-First Express Architecture**: Tailored for both Vercel Serverless Functions and local Node.js development.
- **Three-Pillar Core Model**:
  - **Merchant**: Business identity with isolated API keys, connected accounts, and transactions.
  - **Connected Payment Account**: Dedicated UPI/bank account connection. Maximum of 3 accounts per merchant, with strict verification and single-active checkout exclusivity.
  - **Payment Order**: Server-verified payment orders with internal IDs (`IPYYYYMMDDXXXXXX`), dynamic payment links, and strict server-side verification.
- **Server-Side Transaction Verification & Matching**: Safe, idempotent payment matching engine reconciles bank/UPI transaction emails to pending orders. **An order is NEVER marked successful by a client redirect, query parameter, or frontend callback.**
- **Secure Hashed API-Key System**: High-entropy keys (`ip_live_...`) with SHA-256 database hashing, key rotation, and revocation.
- **Sliding-Window Rate Limiting**: Keyed by merchant API key and client IP with HTTP 429 and standard headers (`X-RateLimit-*`).
- **Encrypted Credential Storage**: AES-256-GCM authenticated encryption for sensitive integration secrets at rest.

---

## 2. Architecture & Directory Structure

```
infinitypay-api/
├── api/
│   ├── index.js                  # Main Vercel serverless function entrypoint
│   └── health.js                 # Standalone health check serverless function
├── lib/
│   ├── config.js                 # Central environment configuration & defaults
│   ├── responses.js              # Standardized JSON response envelope & error codes
│   ├── crypto.js                 # AES-256-GCM encryption, secure key generation & SHA-256 hashing
│   ├── validation.js             # Strict input validation (amounts, mobile numbers, URLs)
│   ├── rate-limiter.js           # Sliding-window rate limiter by API key & IP
│   ├── db.js                     # Prisma client singleton, connection pooling & data services
│   ├── auth.js                   # API key authentication & cron secret middleware
│   ├── gmail.js                  # Gmail transaction sync & email parsing module
│   ├── payment-matcher.js        # Server-side matching engine & order verification
│   ├── app.js                    # Express app with Helmet, CORS, body parsers, routes
│   └── routes/
│       ├── health.js             # GET /api/health
│       ├── developer.js          # Keys, create-order, order-status
│       ├── accounts.js           # Connected accounts CRUD, verify, activate, sync
│       ├── checkout.js           # Public checkout details for payment links
│       └── cron.js               # Scheduled transaction sync endpoint
├── prisma/
│   ├── schema.prisma             # PostgreSQL schema with indexes and relationships
│   └── seed.js                   # Development database seeder
├── tests/
│   ├── setup.js                  # Test fixtures & in-memory database helper
│   ├── health.test.js            # Health check test
│   ├── auth.test.js              # API key lifecycle, hashing, and revocation
│   ├── accounts.test.js          # Account CRUD, limit of 3, verification & exclusivity
│   ├── orders.test.js            # Order creation, validation & merchant isolation
│   ├── payment-matcher.test.js   # Transaction matching, idempotency & verification
│   └── rate-limiter.test.js      # Sliding-window rate limiting & HTTP 429
├── server.js                     # Local development Express server
├── vercel.json                   # Vercel deployment rewrites & cron configuration
├── package.json                  # Dependencies & npm scripts
├── .env.example                  # Environment variable reference
├── API.md                        # Complete API reference documentation
└── README.md                     # Architecture, setup & deployment guide
```

---

## 3. Local Installation & Setup

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- PostgreSQL database (Supabase, Neon, AWS RDS, local PostgreSQL, or Docker)

### Installation
```bash
# 1. Clone or navigate to the project directory
cd "c:\Users\V I N X\Desktop\InfinityPay API"

# 2. Install dependencies
npm install

# 3. Create .env from the template
cp .env.example .env
```

---

## 4. Environment Variables

Configure your `.env` file with appropriate values:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `PORT` | Local HTTP port | `3000` |
| `NODE_ENV` | Environment (`development`, `test`, `production`) | `development` |
| `API_BASE_URL` | Base API URL (used for dynamic payment links) | `http://localhost:3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db?schema=public` |
| `INFINITYPAY_API_SECRET` | Master secret for system signing | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | Secret token to authenticate scheduled cron jobs | `openssl rand -hex 16` |
| `GMAIL_CLIENT_ID` | Google OAuth Client ID (optional) | `...apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | Google OAuth Client Secret (optional) | `...` |
| `GMAIL_REDIRECT_URI` | Google OAuth redirect URI | `https://YOUR-APP.vercel.app/api/auth/callback` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins or `*` | `http://localhost:3000,http://localhost:5173` |

---

## 5. Database Setup & Prisma Migrations

When connecting to a real PostgreSQL database (e.g. Supabase, Neon):

```bash
# Generate Prisma Client
npm run prisma:generate

# Apply migrations to database
npm run prisma:migrate

# Seed development merchant and API key
npm run prisma:seed
```

*(Note: The test suite runs out-of-the-box with an in-memory data adapter without requiring a running PostgreSQL server).*

---

## 6. Running Locally

```bash
# Start local development server
npm run dev
# Or
npm start
```

The server will be available at:
`http://localhost:3000`

---

## 7. Automated Testing

Run the full automated test suite covering authentication, account limits, activation exclusivity, order creation, input validation, payment matching, and rate limiting:

```bash
npm test
```

---

## 8. API Authentication

All authenticated endpoints require an InfinityPay API key passed via either header:

```http
X-InfinityPay-Key: ip_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Or:
```http
Authorization: Bearer ip_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are:
1. Generated securely using high-entropy random bytes.
2. Returned in plaintext **ONLY once** upon creation.
3. Stored in the database as a **SHA-256 cryptographic hash**.
4. Tracked with creation date, active/revoked status, and last-used timestamp.

---

## 9. Core Workflows & Examples

### 9.1 Generate Merchant API Key
```bash
curl -X POST http://localhost:3000/api/developer/keys \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_name": "Acme Corp",
    "merchant_email": "billing@acme.com",
    "name": "Production Key"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "API key created successfully. Store it safely; it will not be shown again.",
  "data": {
    "key_id": "key_a9f1bc2d",
    "api_key": "ip_live_8f0a1c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a",
    "created_at": "2026-09-13T11:22:48.000Z"
  }
}
```

### 9.2 Connect Payment Account
Merchants can connect up to 3 payment accounts:
```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -H "X-InfinityPay-Key: ip_live_YOUR_KEY" \
  -d '{
    "phone_number": "9876543210",
    "upi_id": "acme@okhdfcbank",
    "email": "payments@acme.com"
  }'
```

### 9.3 Verify and Activate Account
An account must be verified before activation, and only one account can be active at a time:
```bash
# 1. Verify Account
curl -X POST http://localhost:3000/api/accounts/acc_12345678/verify \
  -H "X-InfinityPay-Key: ip_live_YOUR_KEY"

# 2. Activate for Checkout
curl -X POST http://localhost:3000/api/accounts/acc_12345678/activate \
  -H "X-InfinityPay-Key: ip_live_YOUR_KEY"
```

### 9.4 Create Payment Order
```bash
curl -X POST http://localhost:3000/api/developer/create-order \
  -H "Content-Type: application/json" \
  -H "X-InfinityPay-Key: ip_live_YOUR_KEY" \
  -d '{
    "amount": 499,
    "title": "Order #123",
    "customer_mobile": "9999999999",
    "redirect_url": "https://merchant.example.com/payment-return"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Order created",
  "data": {
    "order_id": "IP202609138F92B1C4",
    "payment_url": "http://localhost:3000/api/checkout/IP202609138F92B1C4",
    "amount": 499,
    "status": "pending",
    "expires_at": "2026-09-13T11:37:48.000Z"
  }
}
```

### 9.5 Fetch Order Status
```bash
curl -X GET http://localhost:3000/api/developer/order-status/IP202609138F92B1C4 \
  -H "X-InfinityPay-Key: ip_live_YOUR_KEY"
```

**Response:**
```json
{
  "success": true,
  "message": "Status fetched",
  "data": {
    "order_id": "IP202609138F92B1C4",
    "status": "pending",
    "amount": 499
  }
}
```

---

## 10. Transaction Matching & Server Verification

### Critical Security Rule
> [!IMPORTANT]
> **NO CLIENT-SIDE TRUST**:
> - A customer returning to `redirect_url` NEVER marks an order as successful.
> - A frontend JavaScript fetch/callback NEVER marks an order as successful.
> - An order ONLY transitions to `success` when verified server-side by the `payment-matcher` engine.

### Safe Matching Algorithm
1. **Uniqueness**: Each bank transaction has a unique `source_message_id` and `utr` to prevent duplicate ingestion.
2. **Amount Reconciliation**: Exact monetary match with 2-decimal normalization.
3. **Timestamp Windows**: Transaction date must align with order creation window.
4. **Idempotency**: One transaction can only fulfill **one** order.
5. **Ambiguity Prevention**: If two identical-amount orders are active without distinguishing reference notes, both orders remain `pending` to prevent erroneous fulfillment.

---

## 11. Vercel Deployment Guide

Deploying from VS Code to Vercel requires zero complex setup:

### Step 1: Open Project in VS Code
Open the project root in VS Code and open an integrated terminal (`Ctrl + \`` or `Cmd + \``).

### Step 2: Install Vercel CLI (if not already installed)
```bash
npm install -g vercel
```

### Step 3: Link Project & Set Environment Variables
Log in to Vercel and link the project:
```bash
vercel login
vercel link
```

Set the required environment variables in your Vercel Project Dashboard (or via CLI `vercel env add`):
- `DATABASE_URL` (e.g. Neon, Supabase, or AWS RDS PostgreSQL pooler)
- `INFINITYPAY_API_SECRET`
- `ENCRYPTION_KEY`
- `CRON_SECRET`
- `API_BASE_URL` (leave blank or set to your Vercel URL)

### Step 4: Deploy
```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Step 5: Verify Deployment
Once deployed, Vercel gives you your production URL, for example:
`https://infinitypay-api.vercel.app`

Verify the health check endpoint:
```bash
curl -i https://YOUR-VERCEL-PROJECT.vercel.app/api/health
```

Expected output:
```json
{
  "success": true,
  "service": "InfinityPay API",
  "status": "online"
}
```

### Step 6: Automated Scheduled Sync with Vercel Cron
`vercel.json` automatically registers the transaction synchronization job:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
      "schedule": "*/5 * * * *"
    }
  ]
}
```
Vercel will trigger `/api/cron/sync` every 5 minutes with the `x-vercel-cron` header to keep all merchant active accounts synchronized.

---

## 12. Identifying the API Base URL

Do **NOT** hardcode a fixed hostname into frontend or client libraries.

- In local development:
  `http://localhost:3000`
- In staging/production:
  `https://YOUR-VERCEL-PROJECT.vercel.app`

The backend dynamically inspects request host headers (`x-forwarded-host`, `host`) and the `API_BASE_URL` environment variable so payment URLs always reflect the actual active deployment domain.

---

## 13. How the Future Frontend Connects to this API

When building the customer-facing checkout page or merchant dashboard:

1. **Merchant Dashboard Frontend**:
   - Stores the merchant's API key securely in merchant server-side session or authenticated client state.
   - Calls `/api/accounts` to manage connected UPI accounts and activate them.
   - Calls `POST /api/developer/create-order` to generate a new payment order.
   - Receives `{ order_id, payment_url, amount, status: "pending" }`.

2. **Customer Checkout Frontend**:
   - Customer is redirected to or opens `payment_url`: `https://YOUR-VERCEL-PROJECT.vercel.app/api/checkout/IP20260913XXXXXX`.
   - Frontend calls `GET /api/checkout/:orderId` to display the merchant name, UPI ID, amount, and order QR code.
   - Frontend periodically polls `GET /api/checkout/:orderId` (or merchant backend polls `GET /api/developer/order-status/:orderId`) to detect when the status transitions from `pending` to `success`.
   - Once server verification marks the order as `success`, the frontend redirects the customer to `redirect_url`.

---

## 14. Production Security Checklist

- [x] **No plaintext secrets**: Raw API keys and Gmail credentials are never stored in plaintext.
- [x] **No credentials in responses**: Database URLs, hashes, and encryption keys are strictly omitted from JSON payloads.
- [x] **Merchant data isolation**: All queries filter by authenticated `merchantId`.
- [x] **Safe rate limiting**: Standard HTTP 429 status and sliding window headers.
- [x] **CORS & Helmet**: Secure headers and configurable origin whitelist.
- [x] **Zero client payment status trust**: Only server-side transaction matching transitions orders to `success`.
