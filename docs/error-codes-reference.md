# API Error Codes Reference

**Last Updated:** March 16, 2026  
**Status:** Production

## Overview

Complete reference of all error codes returned by the API, including their meaning, likely causes, and recommended user actions.

---

## HTTP Status Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 200 | OK | Request succeeded |
| 201 | Created | Resource successfully created |
| 204 | No Content | Request succeeded, no body to return |
| 400 | Bad Request | Invalid input, malformed JSON, missing fields |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Authenticated but lacks permission (cross-tenant access) |
| 404 | Not Found | Resource doesn't exist or has been deleted |
| 409 | Conflict | Request conflicts with current state (e.g., duplicate) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error, usually transient |
| 502 | Bad Gateway | Database or downstream service unavailable |
| 503 | Service Unavailable | Server temporarily unavailable, retry later |

---

## Application-Specific Error Codes

Error responses follow this format:
```json
{
  "error": {
    "code": "ERR_CODE",
    "message": "Human-readable message",
    "details": {
      "field": "additional context"
    },
    "retryable": true,
    "requestId": "req_abc123xyz"
  }
}
```

### Authentication Errors

#### ERR_AUTH_MISSING_TOKEN
- **HTTP Status**: 401
- **Message**: "Authentication token missing"
- **Cause**: Request missing `Authorization: Bearer <token>` header
- **User Action**: Login again to get a fresh token
- **Retryable**: No
- **Fix**:
  ```javascript
  // Ensure token is sent
  const response = await fetch('/api/products', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  ```

#### ERR_AUTH_INVALID_TOKEN
- **HTTP Status**: 401
- **Message**: "Invalid or expired authentication token"
- **Cause**: Token malformed, expired, or revoked
- **User Action**: Logout and login again
- **Retryable**: No
- **Fix**: Clear localStorage, redirect to login

#### ERR_AUTH_TOKEN_EXPIRED
- **HTTP Status**: 401
- **Message**: "Authentication token has expired"
- **Cause**: Token validity period has passed (typically 24 hours)
- **User Action**: Automatic on next request - refresh token or re-login
- **Retryable**: Yes (with refresh token)
- **Fix**:
  ```javascript
  // Implement auto-refresh
  if (error.code === 'ERR_AUTH_TOKEN_EXPIRED') {
    const newToken = await refreshToken();
    // Retry original request with new token
  }
  ```

#### ERR_AUTH_INVALID_SIGNATURE
- **HTTP Status**: 401
- **Message**: "Token signature verification failed"
- **Cause**: Token was modified or signed with different key
- **User Action**: Clear cookies, logout, login again
- **Retryable**: No
- **Developer Action**: Check JWT signing key configuration

---

### Authorization Errors

#### ERR_FORBIDDEN_CROSS_TENANT_ACCESS
- **HTTP Status**: 403
- **Message**: "Cannot access resources from another organization"
- **Cause**: User attempting to access product/area from different organization
- **User Action**: Verify you're in the correct organization (check org switcher)
- **Retryable**: No, indicates misconfiguration
- **Developer Action**: Verify organizationId in JWT matches resource

#### ERR_FORBIDDEN_INSUFFICIENT_PERMISSIONS
- **HTTP Status**: 403
- **Message**: "User does not have permission for this action"
- **Cause**: User role doesn't allow this operation
- **User Action**: Contact organization admin to grant permission
- **Retryable**: No
- **Valid Scenarios**:
  - Regular user trying to manage settings (needs admin role)
  - User trying to manage billing (needs owner/billing role)

#### ERR_FORBIDDEN_SUBSCRIPTION_REQUIRED
- **HTTP Status**: 403
- **Message**: "Active subscription required for this feature"
- **Cause**: User's subscription has expired or is on Free tier trying pro feature
- **User Action**: Upgrade subscription plan
- **Retryable**: No
- **Feature Mapping**:
  - CSV uploads: Professional or Enterprise tier
  - Store areas: Professional or Enterprise tier
  - Advanced reporting: Enterprise tier only

---

### Validation Errors

#### ERR_VALIDATION_INVALID_JSON
- **HTTP Status**: 400
- **Message**: "Request body is not valid JSON"
- **Cause**: Malformed JSON in request body
- **User Action**: Check JSON syntax (common: trailing comma, unquoted string)
- **Retryable**: No
- **Fix**: Use JSON validator, check quotes and commas

#### ERR_VALIDATION_MISSING_FIELD
- **HTTP Status**: 400
- **Message**: "Missing required field: {fieldName}"
- **Cause**: Required field not provided in request
- **User Action**: Provide the missing field
- **Retryable**: No
- **Example**:
  ```json
  {
    "error": {
      "code": "ERR_VALIDATION_MISSING_FIELD",
      "details": { "field": "name" }
    }
  }
  ```

#### ERR_VALIDATION_INVALID_FIELD
- **HTTP Status**: 400
- **Message**: "Invalid value for field: {fieldName}"
- **Cause**: Field value invalid type, format, or range
- **Retryable**: No
- **Examples**:
  - `price: "abc"` (expects number)
  - `expiry_date: "invalid-date"` (expects YYYY-MM-DD)
  - `quantity: -5` (expects positive integer)

#### ERR_VALIDATION_INVALID_EMAIL
- **HTTP Status**: 400
- **Message**: "Invalid email address format"
- **Cause**: Email doesn't match valid format
- **User Action**: Check email spelling
- **Retryable**: No
- **Pattern**: Must be `user@domain.ext`

#### ERR_VALIDATION_PASSWORD_TOO_WEAK
- **HTTP Status**: 400
- **Message**: "Password does not meet security requirements"
- **Cause**: Password < 8 chars, no uppercase, no numbers, or no special chars
- **Requirements**:
  - Minimum 8 characters
  - At least one uppercase letter (A-Z)
  - At least one number (0-9)
  - At least one special character (!@#$%^&*)
- **User Action**: Create stronger password

#### ERR_VALIDATION_DUPLICATE_EMAIL
- **HTTP Status**: 409
- **Message**: "Email already registered"
- **Cause**: Email already has account
- **User Action**: Login with that email or use different email
- **Retryable**: No

---

### CSV Upload Errors

#### ERR_CSV_INVALID_FORMAT
- **HTTP Status**: 400
- **Message**: "CSV file format is invalid"
- **Cause**: Missing required columns or invalid encoding
- **Required Columns**:
  - `name` (product name)
  - `barcode` (optional, unique within org)
  - `category` (optional, string)
- **User Action**: 
  - Verify file is CSV format
  - Check column headers match required names
  - Ensure UTF-8 encoding (not ANSI or UTF-16)
- **Retryable**: No

#### ERR_CSV_MISSING_HEADERS
- **HTTP Status**: 400
- **Message**: "Missing required CSV headers: {columns}"
- **Cause**: Required column not found
- **Expected Headers**: `name, barcode, category, description`
- **User Action**: Add missing columns to CSV
- **Retryable**: No
- **Example Fix**:
  ```
  # ❌ Wrong
  Product,Code
  Widget,W123

  # ✅ Correct
  name,barcode,category
  Widget,W123,Widgets
  ```

#### ERR_CSV_EMPTY_FILE
- **HTTP Status**: 400
- **Message**: "CSV file is empty"
- **Cause**: File has no data rows (headers OK, but 0 rows)
- **User Action**: Add data rows to CSV
- **Retryable**: No

#### ERR_CSV_PARSE_ERROR
- **HTTP Status**: 400
- **Message**: "Error parsing CSV at line {lineNumber}: {reason}"
- **Cause**:
  - Invalid encoding (must be UTF-8)
  - Unclosed quotes
  - Line too long
  - Invalid character
- **User Action**: 
  - Re-save CSV as UTF-8
  - Check for special characters that need escaping
  - Break into multiple files if too large
- **Retryable**: No

#### ERR_CSV_ROW_INVALID
- **HTTP Status**: 400
- **Message**: "Row {rowNumber} invalid: {reason}"
- **Cause**: Data in row doesn't validate
- **Common Issues**:
  - `name` is empty or NULL
  - `expiry_date` not valid date format
  - `quantity` is not a number
  - `barcode` already exists
- **User Action**: Fix the specific row and retry
- **Response includes**: Array of invalid rows with details
- **Retryable**: Yes (after fixing rows)

#### ERR_CSV_DUPLICATE_BARCODE
- **HTTP Status**: 409
- **Message**: "Barcode already exists: {barcode}"
- **Cause**: Another product in your organization has this barcode
- **User Action**: 
  - Use unique barcode
  - Or remove barcode if optional
- **Retryable**: No (data conflict, not transient)

#### ERR_CSV_FILE_TOO_LARGE
- **HTTP Status**: 413
- **Message**: "File size exceeds maximum allowed (500MB)"
- **Cause**: CSV file > 500MB
- **User Action**: Split into multiple files and upload separately
- **Retryable**: No
- **Recommended**: Split into files < 100MB

#### ERR_CSV_UPLOAD_TIMEOUT
- **HTTP Status**: 504
- **Message**: "CSV processing timed out after 5 minutes"
- **Cause**: Very large file taking too long to process
- **User Action**: 
  - Split file into smaller chunks
  - Try again during off-peak hours
- **Retryable**: Yes, try with smaller file

#### ERR_CSV_PRESIGNED_URL_EXPIRED
- **HTTP Status**: 410
- **Message**: "Presigned upload URL has expired"
- **Cause**: Too much time passed between URL generation and upload (>6 hours)
- **User Action**: Generate new presigned URL and retry
- **Retryable**: Yes
- **Prevention**: Don't delay upload >6 hours after generation

---

### Product Management Errors

#### ERR_PRODUCT_NOT_FOUND
- **HTTP Status**: 404
- **Message**: "Product not found"
- **Cause**: Product ID doesn't exist or deleted
- **User Action**: Verify product ID, check if deleted by other user
- **Retryable**: No

#### ERR_PRODUCT_INVALID_BARCODE
- **HTTP Status**: 400
- **Message**: "Barcode already in use by another product"
- **Cause**: Attempting to create/update with existing barcode
- **User Action**: Use unique barcode or leave empty
- **Retryable**: No

#### ERR_PRODUCT_DELETE_FAILED
- **HTTP Status**: 500
- **Message**: "Failed to delete product, please try again"
- **Cause**: Database issue, transient failure
- **User Action**: Retry the delete operation
- **Retryable**: Yes
- **If Persists**: Report to support

---

### Store Area Errors

#### ERR_STORE_AREA_NOT_FOUND
- **HTTP Status**: 404
- **Message**: "Store area not found"
- **Cause**: Area ID doesn't exist or deleted
- **User Action**: Verify area ID, check if deleted
- **Retryable**: No

#### ERR_STORE_AREA_IN_USE
- **HTTP Status**: 409
- **Message**: "Cannot delete store area with products"
- **Cause**: Store area has products assigned, cannot delete while in use
- **User Action**: Reassign products to different area, then delete
- **Retryable**: No

---

### Database & Infrastructure Errors

#### ERR_DATABASE_CONNECTION_FAILED
- **HTTP Status**: 502
- **Message**: "Database connection failed, please try again"
- **Cause**: 
  - Database not responding
  - Network issue
  - Connection pool exhausted
  - Transient database outage
- **User Action**: Retry request (likely resolves)
- **Retryable**: Yes, with exponential backoff
- **If Persists**: Check Neon dashboard status
- **Typical Retry Strategy**:
  ```javascript
  // Retry up to 3 times with exponential backoff
  // Delays: 100ms, 200ms, 400ms
  ```

#### ERR_DATABASE_QUERY_TIMEOUT
- **HTTP Status**: 504
- **Message**: "Database query timed out"
- **Cause**: Query taking >30 seconds
- **User Action**: Retry (may succeed if database less busy)
- **Retryable**: Yes
- **If Recurring**: Report to support (query performance issue)

#### ERR_DATABASE_CONNECTION_POOL_EXHAUSTED
- **HTTP Status**: 503
- **Message**: "Too many concurrent requests, please try again"
- **Cause**: All database connections in use
- **User Action**: Wait a moment and retry
- **Retryable**: Yes
- **If Frequent**: Indicates need to scale database

#### ERR_STORAGE_UNAVAILABLE
- **HTTP Status**: 503
- **Message**: "File storage service unavailable"
- **Cause**: Cloudflare R2 temporarily down
- **User Action**: Retry after 30 seconds
- **Retryable**: Yes
- **If Persists**: Check Cloudflare status page

#### ERR_STORAGE_QUOTA_EXCEEDED
- **HTTP Status**: 507
- **Message**: "Storage quota exceeded"
- **Cause**: Organization has reached storage limit
- **User Action**: 
  - Delete old unnecessary files
  - Upgrade storage plan
- **Retryable**: No (need to free space)

---

### Rate Limiting Errors

#### ERR_RATE_LIMIT_EXCEEDED
- **HTTP Status**: 429
- **Message**: "Rate limit exceeded. Retry after {seconds} seconds"
- **Cause**: Too many requests from same user/IP
- **Limits**:
  - General API: 100 requests/minute per user
  - CSV uploads: 10 uploads/hour per organization
  - Presigned URLs: 50 URLs/hour per user
  - Password reset: 5 per hour per email
- **User Action**: Wait before retrying
- **Retryable**: Yes, after waiting
- **Response Header**: `Retry-After: {seconds}`

#### ERR_PRESIGNED_URL_RATE_LIMIT
- **HTTP Status**: 429
- **Message**: "Presigned URL request limit exceeded"
- **Cause**: Generated too many presigned URLs too quickly
- **User Action**: Wait 5-10 minutes before requesting new URL
- **Retryable**: Yes, after delay
- **Prevention**: Reuse URLs when possible, don't generate multiple for same file

---

### Billing & Subscription Errors

#### ERR_BILLING_PAYMENT_FAILED
- **HTTP Status**: 402
- **Message**: "Payment failed: {reason}"
- **Causes**:
  - Card declined
  - Insufficient funds
  - Expired card
  - Fraudulent transaction detected
- **User Action**: 
  - Update payment method
  - Use different card
  - Contact bank if repeatedly declined
- **Retryable**: Yes, with different card
- **Won't Retry Automatically**: Security risk

#### ERR_BILLING_INVALID_CARD
- **HTTP Status**: 400
- **Message**: "Invalid payment card"
- **Cause**: Card number, expiry, or CVC invalid
- **User Action**: Verify card details and retry
- **Retryable**: No (user error)

#### ERR_BILLING_CARD_EXPIRED
- **HTTP Status**: 400
- **Message**: "Payment card has expired"
- **Cause**: Card expiration date passed
- **User Action**: Update with valid card
- **Retryable**: No

#### ERR_SUBSCRIPTION_CANCELED
- **HTTP Status**: 403
- **Message**: "Subscription has been canceled"
- **Cause**: Subscription was canceled by user or system
- **User Action**: Upgrade to reactivate
- **Retryable**: No

#### ERR_SUBSCRIPTION_PAST_DUE
- **HTTP Status**: 402
- **Message**: "Subscription payment is past due"
- **Cause**: Automatic payment failed
- **User Action**: Update payment method and retry payment
- **Retryable**: Yes

---

### Webhook Errors

#### ERR_WEBHOOK_SIGNATURE_INVALID
- **HTTP Status**: 401
- **Message**: "Invalid webhook signature"
- **Cause**: 
  - Timestamp outside tolerance (>5 min old)
  - Signature doesn't match
  - Wrong webhook signing secret used
- **Context**: Stripe webhooks only
- **Action**: Reject webhook, don't process

#### ERR_WEBHOOK_DUPLICATE_EVENT
- **HTTP Status**: 409
- **Message**: "This event has already been processed"
- **Cause**: Duplicate webhook received (Stripe resend for reliability)
- **Action**: OK to ignore (idempotency), don't double-process
- **Strategy**: Use event ID for deduplication

---

### General Server Errors

#### ERR_INTERNAL_SERVER_ERROR
- **HTTP Status**: 500
- **Message**: "An unexpected error occurred"
- **Cause**: Unhandled server error
- **User Action**: Retry request
- **Retryable**: Yes
- **Request ID**: Check response for request ID to share with support
- **Developer Action**: Check Sentry for full error trace

#### ERR_SERVICE_UNAVAILABLE
- **HTTP Status**: 503
- **Message**: "Service temporarily unavailable"
- **Cause**:
  - Server restarting/deploying
  - Database scaling
  - Upstream service down
- **User Action**: Retry after 30-60 seconds
- **Retryable**: Yes, with exponential backoff

#### ERR_WORKER_TIMEOUT
- **HTTP Status**: 504
- **Message**: "Request timeout"
- **Cause**: Request took >30 seconds
- **User Action**: Break request into smaller chunks or retry
- **Retryable**: Yes
- **For Large CSVs**: Implement chunked upload

---

## Error Handling Best Practices

### Client-Side (Frontend)

```javascript
// Classify errors
const isRetryable = error.code?.startsWith('ERR_DATABASE_') || 
                   error.code === 'ERR_RATE_LIMIT_EXCEEDED' ||
                   error.code === 'ERR_SERVICE_UNAVAILABLE';

// Implement exponential backoff
async function retryFetch(url, options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delay = Math.pow(2, attempt - 1) * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Show user-friendly messages
const userMessages = {
  'ERR_AUTH_TOKEN_EXPIRED': 'Please login again',
  'ERR_CSV_FILE_TOO_LARGE': 'File is too large, split into smaller files',
  'ERR_RATE_LIMIT_EXCEEDED': 'Too many requests, please wait a moment',
  'ERR_DATABASE_CONNECTION_FAILED': 'Network issue, retrying automatically...'
};
```

### Server-Side (Backend)

```typescript
// Log with context
logger.error('CSV processing failed', {
  code: 'ERR_CSV_PARSE_ERROR',
  row: 42,
  organizationId: 'org_123',
  fileSizeBytes: 1000000,
  duration_ms: 5000,
  requestId: 'req_abc123'
});

// Return structured errors
res.status(400).json({
  error: {
    code: 'ERR_CSV_PARSE_ERROR',
    message: 'Error parsing CSV at line 42',
    details: { lineNumber: 42 },
    retryable: false,
    requestId: req.id
  }
});
```

---

## Status Page

See real-time service status: [status.yourdomain.com]

For incidents lasting >1 hour, check status page for updates.

---

## Support

**Still having issues?**

1. Check this reference for your error code
2. Try suggested user action or retry
3. Check [status page](https://status.yourdomain.com)
4. Email: support@yourdomain.com
5. Include:
   - Error code
   - Request ID from error response
   - Timestamp of error
   - Steps to reproduce
