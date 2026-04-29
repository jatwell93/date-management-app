# Rollback Procedure: Cloudflare Workers → VPS Express

## Overview

This procedure documents how to quickly revert from production Cloudflare Workers deployment back to the VPS/Express server. Use this shit hits the fan:

- Cloudflare Workers deployment has critical bugs requiring immediate rollback
- R2 or Neon integration is causing cascade failures
- Need to return to last-known-good VPS deployment

**Expected Duration**: 15-30 minutes total (mostly DNS propagation time)  
**Downtime**: 5-10 minutes during DNS switch  
**Data Loss Risk**: None (all data remains in Neon, is backed up, and can be recovered)

---

## Prerequisites

Before executing rollback, ensure:

- [ ] VPS server is running and accessible (SSH into VPS to verify)
- [ ] Express server is configured in production mode
- [ ] PostgreSQL/SQLite database connection is tested
- [ ] `.env` file on VPS is up-to-date with current API keys
- [ ] Domain registrar or DNS provider access is available
- [ ] Team is aware of rollback (post to #incidents Slack channel)

---

## Step-by-Step Rollback

### Phase 1: Verification (5 minutes)

**1.1 SSH into VPS and verify Express server**

```bash
ssh root@your-vps-ip

# Navigate to app directory
cd /home/date-management-app

# Verify Express server is not already running
pm2 list

# If it's not running (Linux/macOS):
NODE_ENV=production npm run start
# Or if using PM2:
pm2 start ecosystem.config.js --env production

# Windows command shell equivalent:
cmd /c set NODE_ENV=production&& npm start
```

**Expected Output**: Express server starts without errors, listens on configured port.

**1.2 Verify database connectivity**

```bash
# From VPS, test liveness and readiness probes
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready

# Detailed health endpoint (tier flags + DB):
curl http://localhost:3000/health/health
```

**1.3 Verify frontend can reach VPS** (if available)

```bash
# From local machine, test connectivity to VPS
curl http://your-vps-domain.com/health/live
# Should return 200 success
```

---

### Phase 2: DNS Switchover (10 minutes)

**2.1 Update DNS A record to point to VPS**

Access your domain registrar or DNS provider (Cloudflare, Route53, GoDaddy, etc.):

| Current (Cloudflare Workers)  | New (VPS)                             |
| ----------------------------- | ------------------------------------- |
| CNAME → workers.dev subdomain | A record → `xxx.xxx.xxx.xxx` (VPS IP) |

**Steps:**

1. Log in to DNS provider dashboard
2. Find your domain's DNS settings
3. Locate the A record for `api.yourdomain.com` (or your API subdomain)
4. Change value to VPS IP address
5. Set TTL to 300 seconds (5 minutes) for faster propagation
6. Save/Apply changes

**Expected**: DNS change visible within 1-5 minutes (varies by provider)

**2.2 Verify DNS propagation**

```bash
# From local machine, repeatedly check DNS
nslookup api.yourdomain.com
# or
dig api.yourdomain.com

# Watch for IP address changing to VPS IP
# Repeat every 30 seconds until updated
```

---

### Phase 3: Frontend Configuration Switch (5 minutes)

**3.1 Update frontend API URL to point to VPS**

In frontend `.env` file:

```env
# Before (Cloudflare Workers)
REACT_APP_API_URL=https://api.yourdomain.com  # resolves to Cloudflare Workers

# After (VPS)
REACT_APP_API_URL=https://api.yourdomain.com  # now resolves to VPS IP
```

**3.2 Rebuild and redeploy frontend**

```bash
# If using static hosting (Vercel, Netlify, GitHub Pages):
npm run build
# Upload build/ directory to hosting provider
# (most providers auto-deploy on push to main)

# If using traditional server hosting:
npm run build
scp -r build/* root@frontend-server:/var/www/html/
# Restart nginx or apache
ssh root@frontend-server "systemctl restart nginx"
```

**Expected**: Frontend starts loading data from VPS API

---

### Phase 4: Verification (5 minutes)

**4.1 Test API endpoints from browser/Postman**

```bash
# Test liveness/readiness endpoints (public)
curl https://api.yourdomain.com/health/live
curl https://api.yourdomain.com/health/ready
curl https://api.yourdomain.com/health/health

# Test product list (requires auth)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.yourdomain.com/api/products

# Test CSV upload endpoint (requires auth)
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.csv" \
  https://api.yourdomain.com/api/upload
```

**Expected**: Liveness returns 200, readiness/health reflect configuration state, protected endpoints return 200 with valid token.

**4.2 Test frontend user flows**

1. Open frontend in browser
2. Log in with test user
3. Navigate to dashboard - should load product data
4. Upload a test CSV file - should process and store

**Expected**: All user-facing flows work without errors

**4.3 Monitor error logs**

```bash
# SSH into VPS
ssh root@your-vps-ip

# Check Express server logs for errors
pm2 logs

# Look for any ERROR or WARN messages
# Should see only normal API requests
```

---

## Emergency Abort (If Rollback Fails)

If any step fails:

1. **Immediately revert DNS**: Point A record back to Cloudflare Workers IP
2. **Restart Workers deployment**: `wrangler deploy` from local
3. **Revert frontend env vars**: Set `REACT_APP_API_URL` back to Workers subdomain
4. **Rebuild frontend**: `npm run build && npm run deploy`
5. **Post incident**: Document what failed for post-mortem

---

## Post-Rollback Tasks

**After successful rollback, complete these:**

- [ ] **Stop Workers deployment**: Deploy empty Workers endpoint or update router to return 410 Gone
- [ ] **Log incident**: Create incident ticket with timestamp and reason
- [ ] **Notify customers**: Post update to status page
- [ ] **Preserve logs**: Download Workers logs for debugging before disabling
- [ ] **Schedule incident review**: Post-mortem within 24 hours
- [ ] **Update runbook**: Document any new learnings

---

## Rollback Checklist (Copy & Paste)

```markdown
## Rollback Execution Checklist - [DATE/TIME]

### Prerequisites

- [ ] VPS SSH access verified
- [ ] Express server started and healthy
- [ ] Database connectivity confirmed
- [ ] DNS provider access available
- [ ] Team notified in #incidents

### DNS Switchover

- [ ] DNS A record updated to VPS IP
- [ ] DNS propagation verified (nslookup/dig)
- [ ] TTL set to 300 seconds

### Frontend Update

- [ ] Frontend .env updated to point to VPS API_URL
- [ ] Frontend rebuilt (npm run build)
- [ ] Frontend redeployed

### Verification

- [ ] API liveness responds (GET /health/live)
- [ ] API readiness checked (GET /health/ready)
- [ ] Detailed health checked (GET /health/health)
- [ ] Product list loads (GET /api/products)
- [ ] CSV upload works (POST /api/upload)
- [ ] Frontend login successful
- [ ] Dashboard loads product data
- [ ] No errors in Express logs

### Post-Rollback

- [ ] Workers deployment stopped/disabled
- [ ] Incident logged with timestamp
- [ ] Customer notification posted to status page
- [ ] Logs preserved for debugging
- [ ] Post-mortem scheduled for 24 hours

**Rollback Completed**: **\_** (timestamp)  
**Executed By**: **\_** (name)  
**Verified By**: **\_** (name)
```

---

## Monitoring During Rollback

Watch these metrics during rollback:

| Metric                   | Normal      | Alert    |
| ------------------------ | ----------- | -------- |
| API Response Time        | <500ms      | >2s      |
| Error Rate               | <0.1%       | >1%      |
| Database Connection Pool | 5-10 active | >15 or 0 |
| Memory Usage             | <60%        | >80%     |
| CPU Usage                | <40%        | >70%     |

If alerts trigger, check:

1. Database connection string (verify PostgreSQL running)
2. API key/auth settings in .env
3. Express server logs for errors
4. VPS disk space (errors if <5% free)
5. Network connectivity (ping VPS from local)

---

## Recovery from Partial Rollback

**If DNS is updated but API is unreachable:**

```bash
# Immediately revert DNS
# (takes precedence over infrastructure issues)

# Then fix API:
ssh root@your-vps-ip
pm2 logs             # Check error
pm2 restart app      # Restart Express
pm2 status           # Verify it's running

# Retry from Phase 2 (DNS verification)
```

**If frontend won't load after ENV change:**

```bash
# Clear browser cache
# Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

# If still breaks, check frontend build
npm run build
npm start  # test locally before deploying
```

---

## Related Procedures

- **[Restore from Neon Backup](./neon-backup-restore.md)** - If data corruption during rollback
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - Complete failure scenarios
- **[Incident Response Plan](./incident-response-plan.md)** - Escalation and team contacts

---

## Appendix: VPS Server Details

| Component           | Location                     | Command                         |
| ------------------- | ---------------------------- | ------------------------------- |
| **Express App**     | `/home/date-management-app`  | `npm run start`                 |
| **Environment**     | `.env` (production)          | Update API keys here            |
| **Database**        | PostgreSQL/SQLite            | `psql` or `sqlite3`             |
| **Logs**            | `pm2 logs`                   | Monitor in real-time            |
| **Process Manager** | PM2                          | `pm2 start ecosystem.config.js` |
| **Nginx (if used)** | `/etc/nginx/sites-available` | `systemctl restart nginx`       |
| **SSL Cert**        | Let's Encrypt                | Auto-renewal via certbot        |

---

**Last Updated**: March 7, 2026  
**Next Review**: Quarterly (before each disaster recovery drill)  
**Owner**: DevOps / On-Call Engineer
