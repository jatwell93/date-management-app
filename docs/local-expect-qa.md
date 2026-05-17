# Local Expect QA

Use this workflow when browser QA needs authenticated pages, admin/team-member role checks, or Stripe billing behavior.

## Goal

Primary QA uses real Clerk sessions. Backend auth bypass is only a fallback for non-auth UI checks and must not be used to validate Clerk sign-in, roles, organization membership, or bootstrap behavior.

## Start the Local Stack

Run the backend on `localhost:3001`:

```powershell
doppler run --project date-management --config dev -- npm run dev --prefix backend
```

Run the frontend on `localhost:3002` with the Expect diagnostics panel enabled:

```powershell
$env:REACT_APP_EXPECT_QA_STATUS='true'
$env:REACT_APP_API_URL='http://localhost:3001'
doppler run --project date-management --config dev -- npm start --prefix frontend
```

If you are not using Doppler for a session, set the same variables in the appropriate `.env` files instead. Do not commit local secret files.

`npm start` rebuilds the generated Tailwind stylesheet before launching the frontend dev server, so
local startup cannot silently reuse stale token utilities from an older `tailwind-output.css`.

The examples above assume you run them from the repository root. If you are already inside
`frontend/`, omit the npm prefix and run:

```powershell
doppler run --project date-management --config dev -- npm start
```

Use `--config dev` for the Doppler environment name. `--prefix` is an npm flag for the package
directory, so `--prefix frontend` means “run the command in `frontend/`”; it is not the Doppler
environment selector.

## Clerk Users

Create or confirm two Clerk development users in the same Clerk application and organization:

- `expect-admin@...` with the admin role used by this app.
- `expect-member@...` with the team member role used by this app.

Sign in through the real app UI at `http://localhost:3002/login`. After login, Expect should see the diagnostics panel on authenticated pages.

The key fields to check are:

- `expect-qa-frontend-role`
- `expect-qa-backend-role`
- `expect-qa-organization-id`
- `expect-qa-bootstrap-status`
- `expect-qa-token`
- `expect-qa-api-base-url`

For the admin user, confirm product catalog upload navigation is visible. For the team member user, confirm it is hidden. If frontend and backend roles differ, treat it as a real Clerk/bootstrap issue.

## Stripe Test Prices

Confirm Stripe CLI is logged in:

```powershell
stripe whoami
```

List existing active recurring prices:

```powershell
stripe prices list --active=true --type=recurring --limit=20
```

If prices are missing, create test recurring prices. Stripe amounts are in cents:

```powershell
stripe prices create --currency=aud --unit-amount=9900 -d "recurring[interval]"=month -d "product_data[name]"="Starter"
stripe prices create --currency=aud --unit-amount=99000 -d "recurring[interval]"=year -d "product_data[name]"="Starter"
stripe prices create --currency=aud --unit-amount=24900 -d "recurring[interval]"=month -d "product_data[name]"="Professional"
stripe prices create --currency=aud --unit-amount=249000 -d "recurring[interval]"=year -d "product_data[name]"="Professional"
stripe prices create --currency=aud --unit-amount=49900 -d "recurring[interval]"=month -d "product_data[name]"="Premium"
stripe prices create --currency=aud --unit-amount=499000 -d "recurring[interval]"=year -d "product_data[name]"="Premium"
```

Map returned `price_...` IDs to frontend variables:

```env
REACT_APP_STRIPE_PRICE_STARTER_MONTHLY=price_...
REACT_APP_STRIPE_PRICE_STARTER_ANNUAL=price_...
REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY=price_...
REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL=price_...
REACT_APP_STRIPE_PRICE_PREMIUM_MONTHLY=price_...
REACT_APP_STRIPE_PRICE_PREMIUM_ANNUAL=price_...
```

Map backend price variables:

```env
STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID=price_...
STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID=price_...
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
```

Set backend Stripe secrets from the Stripe Dashboard or Stripe CLI:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

For local webhook delivery:

```powershell
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Use the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET`.

## Backend Auth Bypass

Backend `TEST_AUTH_BYPASS=true` is acceptable for backend integration tests or browser checks that only need API data and do not claim auth correctness.

Do not use bypass mode to approve:

- Clerk sign-in
- Admin versus team member role behavior
- Organization membership
- Bootstrap timing
- Token claim parsing

Those checks require the real Clerk session workflow above.
