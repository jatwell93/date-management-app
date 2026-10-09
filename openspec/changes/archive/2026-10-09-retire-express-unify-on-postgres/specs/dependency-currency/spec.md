## MODIFIED Requirements

### Requirement: Dependency upgrades preserve the npm supply-chain policy and accepted-risk baseline

Every dependency upgrade SHALL keep all package manifests and lockfiles compliant with the npm
supply-chain source policy and SHALL NOT introduce any new advisory beyond the documented accepted
risks. All dependencies SHALL resolve from `registry.npmjs.org` over HTTPS with no git, remote-tarball,
`file:`, `link:`, wildcard (`*`), or `latest` sources. After any upgrade, `npm audit` SHALL surface
only the accepted `xlsx` and `quagga` (frontend) risks, with the root and
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

### Requirement: Toolchain major upgrades preserve CI gates

A major upgrade of a build or lint toolchain dependency SHALL keep every affected boundary's CI gate
green. An ESLint major upgrade SHALL land as a single coordinated change that keeps the lint gate
passing across root, frontend, and workers despite their mixed flat/legacy configuration. A
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

## REMOVED Requirements

### Requirement: Prisma major upgrade preserves dual-backend parity

**Reason:** Prisma, the SQLite backend, the runtime SQLite migrations and the triplicated schema are
retired. There is one authoritative Postgres migration path, covered by "Single-backend schema and
domain conventions are documented" in `dual-backend-parity`.
