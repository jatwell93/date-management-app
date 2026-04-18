# API Conventions

## Overview

This document outlines the API conventions, error codes, and response formats for the Date Management App backend.

## Authentication

### Clerk Authentication (Recommended)

- **Header**: `Authorization: Bearer <clerk_jwt_token>`
- **Token Source**: Clerk JWT from frontend (`getToken()`)
- **Verification**: Tokens verified using `CLERK_SECRET_KEY`
- **Middleware**: `clerkAuth` middleware on protected routes

### Legacy PIN Authentication (Deprecated)

- **Header**: `Authorization: Bearer <jwt_token>`
- **Token Source**: Custom JWT with PIN validation
- **Middleware**: `authenticateToken` middleware

## Standard Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Response data
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {} // Optional additional context
  }
}
```

## Error Codes

| HTTP Status | Error Code           | Description                                |
| ----------- | -------------------- | ------------------------------------------ |
| 400         | VALIDATION_ERROR     | Invalid request parameters                 |
| 401         | UNAUTHORIZED         | Missing or invalid authentication          |
| 402         | PAYMENT_REQUIRED     | Payment method required (trial conversion) |
| 403         | FORBIDDEN            | Insufficient permissions                   |
| 404         | NOT_FOUND            | Resource not found                         |
| 409         | CONFLICT             | Resource already exists                    |
| 422         | UNPROCESSABLE_ENTITY | Business logic validation failed           |
| 429         | RATE_LIMIT_EXCEEDED  | Too many requests                          |
| 500         | INTERNAL_ERROR       | Server error                               |

## Trial System Endpoints

### GET /api/subscription/trial-status

Get current trial status for the authenticated user's organization.

**Authentication**: Required (Clerk JWT)

**Response**:

```json
{
  "success": true,
  "data": {
    "isInTrial": true,
    "isTrialExpired": false,
    "subscription": {
      "status": "TRIALING",
      "tierLevel": "PROFESSIONAL",
      "trialEndDate": "2026-03-08T13:00:00.000Z",
      "trialStartedAt": "2026-02-23T07:16:04.823Z",
      "trialConvertedAt": null,
      "daysRemaining": 14,
      "billingCycle": "monthly"
    },
    "tierLimits": {
      "maxUsers": 10,
      "maxProducts": 5000,
      "maxStoreAreas": 20,
      "features": [
        "Advanced scanning",
        "Expiry tracking",
        "All reports",
        "CSV uploads",
        "Team management",
        "Organization invites"
      ]
    }
  }
}
```

### POST /api/subscription/convert-trial

Convert a trial subscription to a paid subscription.

**Authentication**: Required (Clerk JWT)
**Rate Limit**: 5 requests per hour per user

**Request Body**:

```json
{
  "paymentMethodId": "pm_stripe_payment_method_id",
  "billingCycle": "monthly" | "annual"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub_123",
      "tierLevel": "PROFESSIONAL",
      "status": "active",
      "billingCycle": "monthly",
      "trialConvertedAt": "2026-02-24T02:24:19.788Z"
    }
  }
}
```

**Error Responses**:

- 400: `paymentMethodId is required`
- 400: `billingCycle must be "monthly" or "annual"`
- 404: `User organization not found`
- 402: `Payment method not valid`
- 500: `Failed to convert trial`

## Webhook Endpoints

### POST /api/webhooks/clerk

Handle Clerk webhook events for user and organization management.

**Authentication**: Svix signature verification using `CLERK_WEBHOOK_SECRET`

**Supported Events**:

- `user.created` - Create user in database
- `user.updated` - Update user information
- `organization.created` - Create organization
- `organizationMembership.created` - Link user to organization

**Response**: Always returns 200 OK (even on errors to prevent webhook retries)

### POST /api/webhooks/stripe

Handle Stripe webhook events for payment processing.

**Authentication**: Stripe signature verification using webhook secret

**Supported Events**:

- `customer.subscription.created` - New subscription
- `customer.subscription.updated` - Subscription changes
- `customer.subscription.deleted` - Canceled subscription
- `invoice.payment_succeeded` - Successful payment
- `invoice.payment_failed` - Failed payment

**Response**: Always returns 200 OK

## Rate Limiting

Current production edge defaults (Cloudflare Workers):

- Anonymous requests: 5 requests per minute
- Authenticated requests: 30 requests per minute

| Endpoint       | Limit        | Time Window |
| -------------- | ------------ | ----------- |
| Login/Register | 5 requests   | 15 minutes  |
| Convert Trial  | 5 requests   | 1 hour      |
| File Uploads   | 10 requests  | 1 hour      |
| Standard APIs  | 100 requests | 15 minutes  |
| Webhooks       | No limit     | -           |

## Pagination

List endpoints support pagination via query parameters:

```
GET /api/resources?page=1&limit=20
```

**Response**:

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

## CORS Configuration

- **Development**: `http://localhost:3000`, `http://localhost:3002`
- **Production**: Configured via `CORS_ORIGINS` environment variable
- **No-Origin Requests**: Rejected in production by default; set `ALLOW_NO_ORIGIN_IN_PRODUCTION=true` only for trusted server-to-server clients
- **Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization

## Request/Response Examples

### Successful Request

```bash
curl -X GET http://localhost:3001/api/subscription/trial-status \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Error Response

```bash
curl -X POST http://localhost:3001/api/subscription/convert-trial \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"billingCycle": "invalid"}'

# Response: 400 Bad Request
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "billingCycle must be \"monthly\" or \"annual\""
  }
}
```

## Testing

### Authentication Headers for Testing

```bash
# Clerk JWT (from frontend localStorage)
AUTH_HEADER="Authorization: Bearer $(cat clerk_token.txt)"

# Legacy JWT (deprecated)
AUTH_HEADER="Authorization: Bearer $(cat legacy_token.txt)"
```

### Webhook Testing

```bash
# Clerk webhook
stripe trigger user.created

# Stripe webhook
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```
