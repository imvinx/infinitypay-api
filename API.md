# InfinityPay API - Complete API Reference

Base URLs:
- **Local**: `http://localhost:3000`
- **Vercel Production**: `https://YOUR-VERCEL-PROJECT.vercel.app`

All endpoints are grouped under `/api/` and strictly return JSON payloads.

---

## Response Envelope Contract

### Standard Success Response (HTTP 200 / 201)
```json
{
  "success": true,
  "message": "Human readable summary",
  "data": {}
}
```

### Standard Error Response (HTTP 4xx / 5xx)
```json
{
  "success": false,
  "message": "Human readable explanation",
  "error": {
    "code": "ERROR_CODE"
  }
}
```

---

## Standard Error Codes

| Code | HTTP Status | Description |
| :--- | :--- | :--- |
| `MISSING_API_KEY` | 401 | No API key was provided in headers |
| `INVALID_API_KEY` | 401 | API key is invalid, malformed, or revoked |
| `UNAUTHORIZED` | 403 / 401 | Action not permitted or suspended merchant account |
| `ACCOUNT_NOT_FOUND` | 404 | Payment account not found or does not belong to merchant |
| `ACCOUNT_NOT_VERIFIED` | 400 | Attempted to activate an unverified account |
| `ACCOUNT_LIMIT_REACHED` | 400 | Merchant has reached the maximum of 3 connected accounts |
| `ANOTHER_ACCOUNT_ALREADY_ACTIVE` | 400 | Conflicts with another active account constraint |
| `INVALID_AMOUNT` | 400 | Amount is missing, non-numeric, <= 0, or formatted currency string |
| `INVALID_MOBILE` | 400 | Mobile number is not a valid 10-digit number |
| `ORDER_NOT_FOUND` | 404 | Order does not exist or does not belong to merchant |
| `TRANSACTION_NOT_FOUND` | 404 | Transaction record was not found |
| `PAYMENT_PENDING` | 200 | Order is pending server transaction verification |
| `PAYMENT_FAILED` | 400 | Payment verification failed or rejected |
| `RATE_LIMITED` | 429 | Request threshold exceeded for sliding window |
| `GMAIL_CONNECTION_FAILED` | 500 | Mailbox connection or decryption failure |
| `GMAIL_SYNC_FAILED` | 500 | Transaction synchronization failure |
| `DATABASE_ERROR` | 500 | Internal database query error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Authentication

Authenticated endpoints require an active InfinityPay API key. Pass via either:

```http
X-InfinityPay-Key: vinx_ip_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Or:
```http
Authorization: Bearer vinx_ip_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Rate Limiting & Headers

All requests return sliding-window rate limit headers:

| Header | Description |
| :--- | :--- |
| `X-RateLimit-Limit` | Maximum allowed requests per window (default 60/min) |
| `X-RateLimit-Remaining` | Remaining requests available in the current window |
| `X-RateLimit-Reset` | Epoch timestamp when current window resets |
| `Retry-After` | Seconds to wait before retrying (present when 429 is returned) |

---

## 1. System Health

### `GET /api/health`
Health check endpoint used by uptime monitors and deployment verification.

- **Auth**: None
- **Response**: `200 OK`
```json
{
  "success": true,
  "service": "InfinityPay API",
  "status": "online"
}
```

---

## 2. Developer API Keys

### `POST /api/developer/keys`
Generates a new API key for the merchant.

- **Auth**: None (initial merchant onboarding) or `X-InfinityPay-Key` (existing merchant)
- **Request Body**:
```json
{
  "merchant_name": "Acme Store",
  "merchant_email": "billing@acme.com",
  "name": "Production Key"
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "message": "API key created successfully. Store it safely; it will not be shown again.",
  "data": {
    "key_id": "key_e4a8b1c2",
    "api_key": "vinx_ip_live_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
    "created_at": "2026-09-13T11:22:48.000Z"
  }
}
```
> [!IMPORTANT]
> The `api_key` is returned in plaintext **ONLY ONCE** at creation time. The database only stores a SHA-256 hash.

---

### `GET /api/developer/keys`
Lists metadata for all API keys belonging to the merchant.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "API keys retrieved",
  "data": {
    "keys": [
      {
        "id": "key_e4a8b1c2",
        "name": "Production Key",
        "key_prefix": "vinx_ip_live_9f8e7d6c",
        "status": "active",
        "last_used_at": "2026-09-13T11:25:10.000Z",
        "created_at": "2026-09-13T11:22:48.000Z",
        "revoked_at": null
      }
    ]
  }
}
```

---

### `DELETE /api/developer/keys/:keyId`
Revokes an API key. Revoked keys immediately fail all authentication checks.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "API key revoked successfully",
  "data": {
    "key_id": "key_e4a8b1c2",
    "status": "revoked"
  }
}
```

---

## 3. Connected Payment Accounts

A merchant can connect a maximum of **3 accounts**. Only **one** verified account can be active at any given time.

### `POST /api/accounts`
Connects a new payment account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Request Body**:
```json
{
  "phone_number": "9876543210",
  "upi_id": "acme@okhdfcbank",
  "email": "payments@acme.com",
  "mailbox_credentials": "app_password_or_token"
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "message": "Connected payment account created. Verification is required before activation.",
  "data": {
    "account_id": "acc_8f91c2b0",
    "phone_number": "9876543210",
    "upi_id": "acme@okhdfcbank",
    "email": "payments@acme.com",
    "verification_status": "pending",
    "status": "inactive",
    "created_at": "2026-09-13T11:23:00.000Z"
  }
}
```

---

### `GET /api/accounts`
Lists all connected accounts for the authenticated merchant.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Connected accounts retrieved",
  "data": {
    "accounts": [
      {
        "account_id": "acc_8f91c2b0",
        "phone_number": "9876543210",
        "upi_id": "acme@okhdfcbank",
        "email": "payments@acme.com",
        "verification_status": "verified",
        "status": "active",
        "verified_at": "2026-09-13T11:24:00.000Z",
        "created_at": "2026-09-13T11:23:00.000Z"
      }
    ]
  }
}
```

---

### `GET /api/accounts/:accountId`
Fetches details of a single account with strict merchant isolation.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`

---

### `POST /api/accounts/:accountId/verify`
Marks the account verification as complete.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Account successfully verified.",
  "data": {
    "account_id": "acc_8f91c2b0",
    "verification_status": "verified",
    "verified_at": "2026-09-13T11:24:00.000Z"
  }
}
```

---

### `POST /api/accounts/:accountId/activate`
Activates an account for checkout.
- Must be verified first.
- Automatically deactivates any previously active account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Account activated for checkout. Any previously active account has been deactivated.",
  "data": {
    "account_id": "acc_8f91c2b0",
    "status": "active",
    "verification_status": "verified"
  }
}
```

---

### `POST /api/accounts/:accountId/deactivate`
Deactivates an active account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`

---

### `DELETE /api/accounts/:accountId`
Deletes a connected account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`

---

### `POST /api/accounts/:accountId/sync`
Manually triggers transaction synchronization and order matching for an account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Request Body (Optional for testing/simulator)**:
```json
{
  "mock_emails": [
    {
      "id": "email_101",
      "subject": "Credit Alert",
      "body": "Dear Customer, credited by Rs. 499.00 on 13-09-2026 from user@upi (UPI Ref no 425612345678)"
    }
  ]
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Account transaction synchronization completed.",
  "data": {
    "account_id": "acc_8f91c2b0",
    "synced_transactions": 1,
    "matched_orders": 1
  }
}
```

---

### `GET /api/accounts/:accountId/transactions`
Retrieves normalized transaction records for the account.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Transactions retrieved",
  "data": {
    "transactions": [
      {
        "id": "tx_4a91b2c3",
        "account_id": "acc_8f91c2b0",
        "sender": "rahul@okhdfcbank",
        "amount": 499,
        "reference": "425612345678",
        "utr": "425612345678",
        "purpose": "Order #123",
        "transaction_date": "2026-09-13T11:25:00.000Z",
        "received_at": "2026-09-13T11:25:02.000Z",
        "source_message_id": "email_101",
        "created_at": "2026-09-13T11:25:02.000Z"
      }
    ]
  }
}
```

---

## 4. Payment Orders & Checkout

### `POST /api/developer/create-order`
Creates a payment order and generates an InfinityPay payment URL.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Request Body**:
```json
{
  "amount": 499,
  "title": "Order #123",
  "customer_mobile": "9876543210",
  "redirect_url": "https://merchant.example.com/payment-return"
}
```
- **Validation Rules**:
  - `amount`: Required, positive number. Formatted currency strings (e.g. `₹499`, `$10`) are rejected.
  - `customer_mobile`: Optional, 10 digits sanitized.
  - `redirect_url`: Optional, valid HTTP/HTTPS URL.
  - Merchant must have an active verified account.
- **Response**: `201 Created`
```json
{
  "success": true,
  "message": "Order created",
  "data": {
    "order_id": "IP202609138F92B1C4",
    "payment_url": "https://infinitypay-api.vercel.app/api/checkout/IP202609138F92B1C4",
    "amount": 499,
    "status": "pending",
    "expires_at": "2026-09-13T11:37:48.000Z"
  }
}
```

---

### `GET /api/developer/order-status/:orderId`
Retrieves live payment status for an order. Merchant isolation strictly enforced.

- **Auth**: Required (`X-InfinityPay-Key`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Status fetched",
  "data": {
    "order_id": "IP202609138F92B1C4",
    "status": "success",
    "amount": 499,
    "matched_transaction_id": "tx_4a91b2c3"
  }
}
```
Statuses: `pending`, `success`, `failed`, `expired`.

---

### `GET /api/checkout/:orderId`
Public checkout info endpoint accessed by customers via the `payment_url`.

- **Auth**: None (Public)
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Order checkout details",
  "data": {
    "order_id": "IP202609138F92B1C4",
    "amount": 499,
    "currency": "INR",
    "title": "Order #123",
    "status": "pending",
    "expires_at": "2026-09-13T11:37:48.000Z",
    "merchant_name": "Acme Store",
    "upi_id": "acme@okhdfcbank",
    "redirect_url": "https://merchant.example.com/payment-return"
  }
}
```

---

## 5. Automated Periodic Sync (Vercel Cron)

### `POST /api/cron/sync` or `GET /api/cron/sync`
Triggered automatically every 5 minutes by Vercel Cron.

- **Auth**: Header `x-vercel-cron` or `Authorization: Bearer <CRON_SECRET>`
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Periodic synchronization completed",
  "data": {
    "processed_accounts": 1,
    "total_synced_transactions": 2,
    "total_matched_orders": 2,
    "details": [
      {
        "account_id": "acc_8f91c2b0",
        "synced": 2,
        "matched": 2,
        "status": "success"
      }
    ]
  }
}
```
