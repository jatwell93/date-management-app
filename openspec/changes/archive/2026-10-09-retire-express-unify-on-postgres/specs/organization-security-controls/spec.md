## MODIFIED Requirements

### Requirement: Rate limiting for invite and role endpoints

The system SHALL apply rate limiting to invite creation, invite acceptance, and role change
endpoints. The primary rate-limiting layer SHALL be Cloudflare WAF Rate Limiting Rules at the
edge: invite creation at 10 requests per 60 seconds per IP, invite acceptance at 5 requests per
60 seconds per IP, and role changes at 20 requests per 3600 seconds per IP. Rate-limit
denials SHALL return HTTP 429.

#### Scenario: Cloudflare WAF blocks excessive invite creation

- **GIVEN** a configured Cloudflare WAF rate limiting rule for invite creation
- **WHEN** a single IP exceeds 10 invite creation requests in 60 seconds
- **THEN** Cloudflare returns HTTP 429 for subsequent requests

#### Scenario: Rate limit documentation is available

- **GIVEN** the rate limiting runbook
- **WHEN** an operator needs to configure or verify WAF rules
- **THEN** the documentation in `docs/plans/2026-04-17-cloudflare-waf-rate-limits.md` provides the rule definitions and verification checklist
