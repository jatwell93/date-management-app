# Disaster Recovery Plan

## Purpose

This runbook documents recovery procedures for critical production failures involving Neon, Cloudflare Workers, and R2.

## Recovery Targets

- RTO (Recovery Time Objective): 4 hours maximum
- RPO (Recovery Point Objective): 1 hour maximum data loss

## Decision Matrix

Use this quick decision matrix during incidents.

- API unavailable, database healthy: start Workers rollback procedure
- Database unavailable/corrupt: restore Neon from backup branch
- Object storage unavailable/deleted: recover uploads from R2 or local backup
- Security compromise suspected: execute security containment and credential rotation first

## Scenario 1: Neon Database Failure

### Indicators

- Database health check failing
- Connection timeouts across endpoints
- Data integrity checks failing

### Recovery Steps

1. Confirm incident severity and open incident channel.
2. Determine if failure is provider outage or data corruption.
3. Create restore branch from most recent good Neon backup.
4. Validate restored branch data integrity:
   - row counts
   - critical constraints
   - key API queries
5. Redirect application to restored branch connection string.
6. Promote restored branch to primary when validated.
7. Monitor for 30 minutes and record incident timeline.

Reference: [docs/neon-backup-restore.md](neon-backup-restore.md)

## Scenario 2: Cloudflare Workers Outage

### Indicators

- API endpoint unreachable globally
- Workers invocation failures spike
- Vendor status indicates edge/API outage

### Recovery Steps

1. Initiate rollback to VPS Express deployment.
2. Update DNS/API routing to VPS endpoint.
3. Verify API health, auth flow, and core endpoints.
4. Keep status page updated every 15 minutes.
5. Maintain degraded/rollback mode until Workers are stable.

Reference: [docs/rollback-procedure.md](rollback-procedure.md)

## Scenario 3: R2 Bucket Deleted or Inaccessible

### Indicators

- Upload/download failures
- Object listing errors
- Missing files for known upload IDs

### Recovery Steps

1. Confirm bucket accessibility via R2 API/CLI.
2. Restore data by syncing from backup source:
   - R2 versioned objects, if enabled
   - local backup copy, if available
3. Validate recovered file counts and checksum samples.
4. Re-point storage config if temporary fallback is required.
5. Monitor upload/download success rates.

Reference: [docs/r2-recovery-procedure.md](r2-recovery-procedure.md)

## Scenario 4: Complete Account Compromise

### Indicators

- Unauthorized config/secrets changes
- Unknown deployments
- Suspicious privileged actions in logs

### Immediate Containment

1. Rotate all secrets immediately:
   - database credentials
   - R2 keys
   - API tokens
   - webhook signing secrets
2. Revoke active sessions and temporary credentials.
3. Freeze production changes except incident response.
4. Preserve logs and deployment metadata for forensics.

### Recovery Steps

1. Rebuild trust boundary (new keys, verified deploy source).
2. Restore data from known-good backups if tampering detected.
3. Redeploy trusted release artifact.
4. Validate access control and audit logs.
5. Notify stakeholders/customers per incident policy.

Reference: [docs/incident-response-plan.md](incident-response-plan.md)

## Communication and Governance

- Public updates: status page every 15 minutes for P1/P2
- Internal updates: incident channel and war room notes
- Post-incident review: within 24 hours of resolution

Reference: [docs/status-page-setup.md](status-page-setup.md)

## Validation Drills

- Quarterly rollback drill (Workers -> VPS)
- Quarterly Neon restore drill (backup -> verified branch)
- Semi-annual R2 recovery drill (object restore + checksum validation)
- Annual security compromise tabletop exercise

For each drill, capture:

- start/end timestamps
- time-to-detect and time-to-recover
- observed data loss window
- remediation actions and owners

## Exit Criteria for Incident Closure

- Service health stable for 30+ minutes
- Data integrity checks pass
- Customer communication posted
- Root cause and corrective actions documented
