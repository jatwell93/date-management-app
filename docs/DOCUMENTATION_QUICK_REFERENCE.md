# Documentation Quick Reference

Use this file as the entry point for durable project documentation. Completed implementation summaries and one-off phase reports should live in OpenSpec archives or source-control history, not in the main `docs/` navigation surface.

## New Developers

1. [../README.md](../README.md) - project overview and workspace commands
2. [../backend/README.md](../backend/README.md) - backend setup, scripts, database, storage, and deployment notes
3. [developer-guide.md](developer-guide.md) - daily workflow, debugging, and contribution flow
4. [TESTING.md](TESTING.md) - root-level backend/frontend test commands
5. [local-expect-qa.md](local-expect-qa.md) - local Expect QA setup

## Architecture And Data

1. [architecture.md](architecture.md) - system architecture overview
2. [multi-tenant-guide.md](multi-tenant-guide.md) - organization and tenant isolation patterns
3. [cross-tenant-isolation-assurance.md](cross-tenant-isolation-assurance.md) - isolation assurance and evidence
4. [database-migrations.md](database-migrations.md) - migration workflow
5. [neon-workflow.md](neon-workflow.md) - Neon branching and database workflow
6. [../backend/docs/database-patterns.md](../backend/docs/database-patterns.md) - backend data-access patterns

## Uploads And Storage

1. [csv-upload-format.md](csv-upload-format.md) - supported CSV/XLSX fields and behavior
2. [../backend/docs/storage-patterns.md](../backend/docs/storage-patterns.md) - local/R2 storage abstraction
3. [cloudflare-setup.md](cloudflare-setup.md) - Cloudflare R2, Workers, and Hyperdrive setup
4. [r2-recovery-procedure.md](r2-recovery-procedure.md) - R2 recovery procedure

## Billing, Trials, And Stripe

1. [stripe-integration.md](stripe-integration.md) - Stripe webhook and billing integration
2. [LOCAL_WEBHOOK_SETUP.md](LOCAL_WEBHOOK_SETUP.md) - local webhook development setup
3. [webhook-troubleshooting.md](webhook-troubleshooting.md) - webhook failure diagnosis
4. [subscription-tiers.md](subscription-tiers.md) - tier behavior and limits
5. [trial-system.md](trial-system.md) - trial lifecycle
6. [trial-expiration-faq.md](trial-expiration-faq.md) - trial expiration support reference
7. [past-due-recovery.md](past-due-recovery.md) - past-due recovery flow
8. [tier-downgrade-guide.md](tier-downgrade-guide.md) - downgrade behavior and support
9. [SAAS_OPERATIONAL_RUNBOOK.md](SAAS_OPERATIONAL_RUNBOOK.md) - subscription operations

## Operations

1. [operational-runbook.md](operational-runbook.md) - production operations
2. [monitoring-and-alerting.md](monitoring-and-alerting.md) - monitoring and alert setup
3. [incident-response-plan.md](incident-response-plan.md) - incident response
4. [disaster-recovery.md](disaster-recovery.md) - disaster recovery
5. [rollback-procedure.md](rollback-procedure.md) - rollback procedure
6. [production-deployment-checklist.md](production-deployment-checklist.md) - deployment checklist
7. [workers-deployment.md](workers-deployment.md) - Workers deployment
8. [status-page-setup.md](status-page-setup.md) - status page setup

## Security And Compliance

1. [security.md](security.md) - security guide
2. [security-audit.md](security-audit.md) - security audit findings and follow-up context
3. [data-retention-policy.md](data-retention-policy.md) - retention policy
4. [error-codes-reference.md](error-codes-reference.md) - API error reference

## Frontend, Handheld, And Brand

1. [../frontend/README.md](../frontend/README.md) - frontend setup
2. [../frontend/TOKENS_COMPLIANCE_GUIDE.md](../frontend/TOKENS_COMPLIANCE_GUIDE.md) - semantic token rules
3. [../frontend/AMBER_USAGE_GUIDE.md](../frontend/AMBER_USAGE_GUIDE.md) - amber restraint policy
4. [../frontend/src/theme/SEMANTIC_COLORS_REFERENCE.md](../frontend/src/theme/SEMANTIC_COLORS_REFERENCE.md) - semantic color reference
5. [voice-audit.md](voice-audit.md) - user-facing messaging audit
6. [handheld/handheld-devices.md](handheld/handheld-devices.md) - PDT device configuration
7. [handheld/handheld-components.md](handheld/handheld-components.md) - handheld UI components
8. [handheld/handheld-testing.md](handheld/handheld-testing.md) - handheld testing
9. [handheld/handheld-troubleshooting.md](handheld/handheld-troubleshooting.md) - handheld troubleshooting

## Historical And Planning Context

Use [../openspec/](../openspec/) for active and archived change goals. Keep `docs/plans/` only for planning artifacts that active OpenSpec tasks still reference directly.
