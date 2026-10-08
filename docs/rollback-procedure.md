# Rollback Procedure: Cloudflare Worker

## Overview

Use this procedure when a production deploy of the Worker (`workers/`) is causing errors and you need to return to a known-good state.

The Worker is the only API. There is no fallback server. The earlier VPS/Express rollback target is retired; the last Express revision is the tag `express-sqlite-last` and is for reading or recovery only, not for serving traffic (see [`express-retirement-recovery.md`](./express-retirement-recovery.md)). The March 2026 drill of the old VPS procedure is kept unedited as a dated record in [`rollback-drill-2026-03-07.md`](./rollback-drill-2026-03-07.md).

Rollback has three layers. Work them in order, and stop at the first one that fixes the problem:

1. **Worker rollback**: redeploy known-good code. Fastest. No database change.
2. **Forward-fix migration**: a new migration that corrects a bad schema change.
3. **Neon restore**: catastrophic only (data corruption).

Do not default to a down migration. Down migrations are manual-only and destructive.

The full decision tree, thresholds and commands live in [`migrations-deploy-runbook.md`](./migrations-deploy-runbook.md), Step 4. This page is the short operator path.

**Data loss risk**: none for layer 1. Layers 2 and 3 are covered by [`neon-backup-restore.md`](./neon-backup-restore.md).

---

## Prerequisites

- [ ] GitHub access to run the `Deploy Workers API` workflow (Actions tab)
- [ ] The SHA of the last known-good deploy
- [ ] Access to Sentry and Cloudflare Workers logs
- [ ] Team is aware of the rollback (post in the incident channel)

---

## Step-by-Step Rollback

### Phase 1: Confirm the problem

```bash
# Health check (deep also checks R2 and the database)
curl https://<api-host>/health
curl "https://<api-host>/health?deep=true"

# Live logs
cd workers
npm run tail:prod
```

Check Sentry for new unresolved fatal issues, and the 5xx rate against the thresholds in the runbook (Step 3, "Stop / rollback thresholds").

### Phase 2: Worker rollback (layer 1)

Choose one:

```bash
# Option 1: revert the merge commit on main.
# A merge to main redeploys the Worker (about 35 minutes including migration prep).
git revert <merge-sha>
git push origin main
```

```text
# Option 2: manual workflow_dispatch from a known-good SHA.
# Actions -> Deploy Workers API -> Run workflow
# Set "Use workflow from" to the known-good SHA.
# Always available; not gated by PRODUCTION_AUTO_DEPLOY_ENABLED.
```

Use Option 2 when you cannot wait for a revert to go through review. Migrations are expand-compatible, so the previous Worker works against the current schema.

### Phase 3: Stop scheduled jobs if they are part of the problem

The hourly cron runs jobs that write data (Stripe reconciliation, emails, markdown recalculation). To stop all of them without a deploy:

```bash
cd workers
wrangler secret put SCHEDULED_JOBS_DISABLED --env production
# enter: true
```

It takes effect on the next tick. Delete the secret (or set it to anything other than `true`) to re-enable.

### Phase 4: Schema or data problem

- If the schema change itself is broken, write a forward-fix migration (runbook Step 4b).
- If data is corrupted, restore from a Neon snapshot (runbook Step 4c, and [`neon-backup-restore.md`](./neon-backup-restore.md)). The restore swaps in for the production branch and keeps the connection string, so the Worker does not need repointing.

### Phase 5: Verify

```bash
curl https://<api-host>/health
curl "https://<api-host>/health?deep=true"
```

1. Sign in to the frontend with a test user.
2. The dashboard loads product data.
3. Upload a small CSV; it processes and stores.
4. Sentry shows no new fatal issues and the 5xx rate is back to normal.

---

## Emergency Abort (If Rollback Fails)

1. Stop further deploys: do not merge to main until the cause is known.
2. Redeploy the last SHA that was known-good before the incident using Option 2.
3. If the new deploy made it worse, redeploy the SHA from before the first bad one.
4. Post the incident status and escalate per the [Incident Response Plan](./incident-response-plan.md).

---

## Post-Rollback Tasks

- [ ] **Log incident**: create an incident ticket with timestamp and reason
- [ ] **Notify customers**: post an update to the status page
- [ ] **Preserve logs**: save Workers logs and the Sentry issue links
- [ ] **Re-enable scheduled jobs** if you disabled them
- [ ] **Schedule incident review**: post-mortem within 24 hours
- [ ] **Update runbook**: record anything new

---

## Rollback Checklist (Copy & Paste)

```markdown
## Rollback Execution Checklist - [DATE/TIME]

### Prerequisites

- [ ] Known-good SHA identified
- [ ] Team notified in the incident channel

### Rollback

- [ ] Worker redeployed from known-good SHA (or revert merged)
- [ ] Deploy workflow finished green
- [ ] Scheduled jobs disabled (if needed)

### Verification

- [ ] GET /health responds
- [ ] GET /health?deep=true responds
- [ ] Frontend login successful
- [ ] Dashboard loads product data
- [ ] CSV upload works
- [ ] No new fatal issues in Sentry

### Post-Rollback

- [ ] Incident logged with timestamp
- [ ] Customer notification posted to status page
- [ ] Logs preserved
- [ ] Scheduled jobs re-enabled
- [ ] Post-mortem scheduled for 24 hours

**Rollback Completed**: **\_** (timestamp)  
**Executed By**: **\_** (name)  
**Verified By**: **\_** (name)
```

---

## Monitoring During Rollback

| Metric            | Normal | Alert |
| ----------------- | ------ | ----- |
| API response time | <500ms | >2s   |
| Error rate        | <0.1%  | >1%   |

If alerts persist, check:

1. Worker secrets are present (`wrangler secret list --env production`)
2. Neon branch status and compute (scale-to-zero cold starts are expected)
3. Hyperdrive binding and connection string
4. Clerk and Stripe status pages

---

## Related Procedures

- **[Migrations deploy runbook](./migrations-deploy-runbook.md)** - Step 4, the full rollback decision tree
- **[Restore from Neon Backup](./neon-backup-restore.md)** - If data corruption during rollback
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - Complete failure scenarios
- **[Incident Response Plan](./incident-response-plan.md)** - Escalation and team contacts

---

**Last Updated**: October 9, 2026  
**Next Review**: Quarterly (before each disaster recovery drill)  
**Owner**: DevOps / On-Call Engineer
