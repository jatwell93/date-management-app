## Why

Security review identified three server-side controls that need hardening now: billing checkout trusts client-supplied Stripe price IDs, the legacy product upload path accepts unbounded multipart files before parsing, and a Workers debug endpoint can trigger unauthenticated errors in production-like deployments.

## What Changes

- Reject Stripe checkout requests whose `priceId` is not one of the backend-configured monthly or annual price IDs for supported tiers.
- Keep the frontend price IDs as display/client hints only; backend Stripe checkout remains the source of truth for allowed prices.
- Add a file-size limit to the legacy `/products/upload-csv` multer path using the existing upload size environment setting.
- Convert legacy upload multer size and file-type failures into stable `400` responses.
- Remove or production-gate the Workers `/api/test-error` endpoint so it is unavailable in production.
- Add focused regression tests for each vulnerable path and positive tests for expected billing/upload behavior.

## Reuse Strategy

- Extend existing Stripe validation utilities and billing controller tests instead of creating a new billing service.
- Extend `backend/src/routes/product.routes.ts` and existing product upload tests instead of replacing the upload pipeline.
- Keep CSV/XLSX parsing in `backend/src/services/product.service.ts`; this patch only enforces request-size limits before parsing.
- Remove or gate the existing Workers test endpoint in `workers/src/index.ts` without changing the router/auth stack.

## Capabilities

### New Capabilities

- `subscription-billing-security`: Backend billing checkout authorization for configured Stripe prices.

### Modified Capabilities

- `cloudflare-workers-api`: Production Workers API must not expose unauthenticated debug error endpoints.
- `csv-upload-processing`: Legacy product upload must enforce the configured maximum upload size before parsing.

## Impact

- **Backend billing:** `backend/src/controllers/subscription.controller.ts`, `backend/src/utils/url-validator.ts`, billing tests.
- **Backend uploads:** `backend/src/routes/product.routes.ts`, product upload tests.
- **Workers:** `workers/src/index.ts`, Workers tests.
- **Config:** Uses existing `envConfig.MAX_UPLOAD_SIZE_BYTES` and these backend Stripe allowlist variables:
  `STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID`, `STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID`,
  `STRIPE_PREMIUM_MONTHLY_PRICE_ID`, `STRIPE_PREMIUM_ANNUAL_PRICE_ID`,
  `STRIPE_CONCIERGE_MONTHLY_PRICE_ID`, and `STRIPE_CONCIERGE_ANNUAL_PRICE_ID`.
- **Verification:** backend focused tests, Workers tests/build, lint, supply-chain check, OpenSpec validation, and Doppler CodeSense delta when available.
