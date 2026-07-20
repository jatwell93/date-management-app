# Local Expect QA

Use this workflow when browser QA needs authenticated pages, admin/team-member role checks, or Stripe billing behavior.

## Goal

Primary QA uses real Clerk sessions. Backend auth bypass is only a fallback for non-auth UI checks and must not be used to validate Clerk sign-in, roles, organization membership, or bootstrap behavior.

## Start the Local Stack

Synchronize the database used by the Express Prisma client before starting the backend. From the
repository root:

```powershell
$env:DATABASE_URL='file:./database.sqlite'
doppler run --project date-management --config dev --preserve-env=DATABASE_URL -- npx prisma db push --schema backend/prisma/schema.prisma
```

The Prisma datasource resolves its relative SQLite URL from `backend/prisma/schema.prisma`, so the
local Express app uses `backend/prisma/database.sqlite`. The custom migration runner uses
`backend/database.sqlite`; running `npm run migrate --prefix backend` does not synchronize the
database used by local Express QA.

Run the backend on `localhost:3001`:

```powershell
$env:DATABASE_URL='file:./database.sqlite'
doppler run --project date-management --config dev --preserve-env=DATABASE_URL -- npm run dev --prefix backend
```

Run the frontend on `localhost:3002` with the Expect diagnostics panel enabled:

```powershell
$env:REACT_APP_EXPECT_QA_STATUS='true'
$env:REACT_APP_API_URL='http://localhost:3001'
$env:BROWSER='none'
doppler run --project date-management --config dev --preserve-env=REACT_APP_API_URL,REACT_APP_EXPECT_QA_STATUS,BROWSER -- npm start --prefix frontend
```

Doppler normally replaces variables that already exist in the shell. Keep `--preserve-env` in the
frontend command so the QA API URL and diagnostics flag cannot be overwritten by remote development
configuration. Before testing a feature, confirm the diagnostics panel reports
`api-base-url: http://localhost:3001`; if it reports a remote URL, restart the frontend with the
command above.

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

For an interactive Clerk sign-in:

1. Launch Expect in headed Chromium at `http://localhost:3002/login`.
2. Pause browser automation while the tester enters the saved development-user credentials.
3. Resume only after the authenticated page and organization have loaded.
4. Verify every diagnostic below before relying on feature results.

Do not create or alter Clerk users, organization membership, or roles during QA unless the user has
explicitly authorized that external change.

The key fields to check are:

- `expect-qa-frontend-role`
- `expect-qa-backend-role`
- `expect-qa-organization-id`
- `expect-qa-bootstrap-status`
- `expect-qa-token`
- `expect-qa-api-base-url`

For the admin user, confirm product catalog upload navigation is visible. For the team member user, confirm it is hidden. If frontend and backend roles differ, treat it as a real Clerk/bootstrap issue.

## Browser QA Checklist

Run the feature's acceptance scenarios at desktop and mobile widths. At minimum:

- Check role-gated controls with real admin and team-member sessions.
- Exercise validation, confirmation, empty, success, and conflict states without destroying shared
  fixtures.
- Confirm wide tables and dialogs stay contained at mobile widths and do not create body-level
  horizontal overflow.
- Inspect the browser console for new errors and the API request log for failed requests.
- Run an accessibility audit on the feature region and manually review automated findings that can
  be caused by third-party overlays or modal focus guards.
- Capture performance metrics on the development build, but distinguish development instrumentation
  from production regressions.

Development React mode may issue duplicate read requests while detecting unsafe effects. Treat a
duplicate warning as informational when both requests are successful and there is no write or visible
state duplication; failed requests and duplicate mutations remain blockers.

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
