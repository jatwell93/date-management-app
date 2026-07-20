## ADDED Requirements

### Requirement: Dependency upgrades preserve the npm supply-chain policy and accepted-risk baseline

Every dependency upgrade SHALL keep all package manifests and lockfiles compliant with the npm
supply-chain source policy and SHALL NOT introduce any new advisory beyond the documented accepted
risks. All dependencies SHALL resolve from `registry.npmjs.org` over HTTPS with no git, remote-tarball,
`file:`, `link:`, wildcard (`*`), or `latest` sources. After any upgrade, `npm audit` SHALL surface
only the accepted `xlsx` (backend and frontend) and `quagga` (frontend) risks, with the root and
workers boundaries reporting no vulnerabilities.

#### Scenario: Supply-chain policy holds after a major bump

- **GIVEN** a branch that bumps a dependency to a new major version via a lockfile-only install
- **WHEN** `npm run security:npm-supply-chain` runs
- **THEN** the check passes with every resolved package sourced from `registry.npmjs.org`

#### Scenario: Audit baseline is unchanged by an upgrade

- **GIVEN** a completed dependency upgrade on a boundary
- **WHEN** `npm audit --audit-level=low` runs for that boundary
- **THEN** the only advisories reported are the documented `xlsx` and/or `quagga` accepted risks
- **AND** no new advisory is introduced by the upgrade

### Requirement: Security-sensitive runtime upgrades preserve behaviour

Upgrading a runtime dependency that participates in a security control SHALL NOT change the control's
externally observable behaviour. The request rate-limiting tiers — strict (login and register), upload,
and standard — SHALL enforce the same limits, `429` response body, and `Retry-After` header before and
after any related upgrade. Stripe webhook signature verification and idempotent event handling SHALL
remain unchanged across the Stripe SDK upgrade, and the SDK API version SHALL be explicitly pinned
rather than defaulted.

#### Scenario: Rate-limit tiers behave identically after upgrade

- **GIVEN** the rate-limiting middleware after any related dependency upgrade
- **WHEN** requests exceed the strict, upload, or standard tier limit
- **THEN** the request is rejected with `429`, the documented error body, and a `Retry-After` header
  matching the pre-upgrade behaviour

#### Scenario: Stripe webhook verification survives the SDK major upgrade

- **GIVEN** the Stripe SDK upgraded to the new major with an explicitly pinned `apiVersion`
- **WHEN** a signed webhook event is received
- **THEN** signature verification and idempotency behave exactly as before the upgrade
- **AND** the deployment Stripe config validation still passes

### Requirement: Toolchain major upgrades preserve CI gates

A major upgrade of a build or lint toolchain dependency SHALL keep every affected boundary's CI gate
green. An ESLint major upgrade SHALL land as a single coordinated change that keeps the lint gate
passing across root, backend, frontend, and workers despite their mixed flat/legacy configuration. A
TypeScript major upgrade SHALL keep each boundary's typecheck and build passing, including the workers
`bundle-size` gate within its 256 KiB gzip limit.

#### Scenario: ESLint flat-config migration keeps the lint gate green

- **GIVEN** ESLint bumped to the new major across all boundaries in one change
- **WHEN** `npm run lint` (or `lint:check`) runs on each boundary
- **THEN** every boundary lints successfully under its resolved flat or legacy configuration

#### Scenario: TypeScript major upgrade keeps typecheck and build green

- **GIVEN** a boundary upgraded to the new TypeScript major
- **WHEN** its `type-check`/`build` (and, for workers, `bundle-size`) runs
- **THEN** the typecheck and build succeed and the workers bundle stays under the gzip limit

### Requirement: Prisma major upgrade preserves dual-backend parity

Upgrading Prisma across a major version SHALL keep the triplicated schema — Prisma base schema, Neon
SQL migrations, runtime SQLite migrations, and the pglite test harness — in agreement, and SHALL keep
both the SQLite and Postgres/Neon backends passing their migrations and tests. The generated client
SHALL be regenerated as part of the upgrade.

#### Scenario: Both backends migrate and test green after the Prisma upgrade

- **GIVEN** `@prisma/client` and `prisma` upgraded together to the new major and the client regenerated
- **WHEN** migrations are applied to the SQLite dev database and the Neon test database, and the backend
  suite plus `npm run test:db` and the dual-backend conformance tests run
- **THEN** all migrations apply cleanly and every suite passes on both backends
