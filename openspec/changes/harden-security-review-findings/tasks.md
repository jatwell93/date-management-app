## 1. Stripe Price Allowlist

- [x] 1.1 RED: Add checkout tests proving arbitrary valid-looking `price_...` IDs are rejected.
- [x] 1.2 RED: Add checkout tests proving configured monthly and annual price IDs are accepted.
- [x] 1.3 GREEN: Replace format-only Stripe price validation with backend-configured price allowlist enforcement.

## 2. Legacy Product Upload Limits

- [x] 2.1 RED: Add product upload tests proving files larger than the configured limit are rejected before parsing.
- [x] 2.2 RED: Add product upload tests proving valid CSV/XLSX files within the configured limit still reach the import path.
- [x] 2.3 GREEN: Add `multer` size enforcement and stable `400` handling for legacy upload size/type errors.

## 3. Workers Debug Endpoint

- [x] 3.1 RED: Add Workers coverage proving `/api/test-error` is unavailable in production-like env.
- [x] 3.2 GREEN: Remove or production-gate `/api/test-error` without breaking health/auth routing.

## 4. Verification

- [x] 4.1 Run focused backend tests for billing and product upload.
- [x] 4.2 Run `npm run test --prefix workers`.
- [x] 4.3 Run `npm run build:workers`.
- [ ] 4.4 Run `npm run lint` (ran; blocked by unrelated existing repo lint errors outside this patch. Targeted ESLint on changed backend files passed; Workers files are ignored by the root ESLint config).
- [x] 4.5 Run `npm run security:npm-supply-chain`.
- [ ] 4.6 Run `openspec validate --all` (ran; this change passes, but unrelated existing changes fail validation).
- [ ] 4.7 Run `doppler run -- cs delta` when Doppler is available (attempted with user approval; blocked by external data disclosure approval policy).

## 5. Review Follow-up

- [x] 5.1 Restore Stripe checkout route test `process.env` mutations after the suite.
- [x] 5.2 Surface missing production Stripe price configuration as a server error instead of client validation.
- [x] 5.3 Use a stable upload file-type error code with a canonical `400` response message.
- [x] 5.4 Document the required backend Stripe price environment variables in the proposal.
