## ADDED Requirements

### Requirement: Organization audit logging

The system SHALL record audit events for all organization role and invite state changes. The
audit log SHALL capture: `event_type` (`invite_created`, `invite_accepted`, `invite_revoked`,
`invite_resent`, `role_assigned`, `role_removed`), `actor_user_id`, `actor_organization_id`,
`target_user_id`, `target_organization_id`, `old_role`, `new_role`, `invite_id`, `timestamp`, and
`ip_address`. Sensitive fields (raw tokens) SHALL be excluded from audit metadata. Audit logging
SHALL be wrapped so that an audit failure never blocks the primary operation.

#### Scenario: Role assignment is audited

- **GIVEN** a first-login bootstrap that assigns `admin`
- **WHEN** the bootstrap transaction commits
- **THEN** an audit event `role_assigned` is recorded with the actor and target user IDs

#### Scenario: Invite actions are audited

- **GIVEN** an admin performing invite create, resend, or revoke
- **WHEN** each action completes
- **THEN** the corresponding audit event is recorded with the invite ID and actor identity

#### Scenario: Raw tokens are never in audit metadata

- **GIVEN** an invite creation or resend action
- **WHEN** the audit event is recorded
- **THEN** the metadata contains the invitee email but not the raw invite token

### Requirement: Rate limiting for invite and role endpoints

The system SHALL apply rate limiting to invite creation, invite acceptance, and role change
endpoints. The primary rate-limiting layer SHALL be Cloudflare WAF Rate Limiting Rules at the
edge: invite creation at 10 requests per 60 seconds per IP, invite acceptance at 5 requests per
60 seconds per IP, and role changes at 20 requests per 3600 seconds per IP. An optional in-memory
backend middleware MAY provide defense-in-depth by counting per authenticated userId. Rate-limit
denials SHALL return HTTP 429.

#### Scenario: Cloudflare WAF blocks excessive invite creation

- **GIVEN** a configured Cloudflare WAF rate limiting rule for invite creation
- **WHEN** a single IP exceeds 10 invite creation requests in 60 seconds
- **THEN** Cloudflare returns HTTP 429 for subsequent requests

#### Scenario: Rate limit documentation is available

- **GIVEN** the rate limiting runbook
- **WHEN** an operator needs to configure or verify WAF rules
- **THEN** the documentation in `docs/plans/2026-04-17-cloudflare-waf-rate-limits.md` provides the rule definitions and verification checklist
