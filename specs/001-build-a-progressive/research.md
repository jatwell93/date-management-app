# Research & Decisions

## Automated Backup (Principle V)

**Decision**:
- A nightly cron job will be implemented on the backend server.
- This job will execute a script to create a timestamped `.sql` dump of the SQLite database.
- Backups will be stored in a separate, secure directory on the server.
- Retention policy: Keep daily backups for 7 days, weekly for 4 weeks, and monthly for 6 months.

**Rationale**:
- This provides a robust and automated way to prevent data loss.
- Using a standard `.sql` dump ensures easy restoration.
- The retention policy balances storage costs with the need for historical data.

**Alternatives considered**:
- **Manual Backups**: Rejected as it is error-prone and not reliable.
- **Cloud Storage Sync**: Deferred for now as it adds complexity, but can be considered in a future iteration.

## Deployment Strategy (Principle VIII)

**Decision**:
- The frontend will be deployed as a static site to a CDN for fast delivery.
- The backend will be deployed as a Node.js application on a virtual private server (VPS).
- A simple CI/CD pipeline will be set up using GitHub Actions to automate testing and deployment.
- A staging environment will be created to test new features before deploying to production.
- Feature flags will be used to roll out major changes gradually.

**Rationale**:
- This provides a standard, scalable, and cost-effective deployment setup.
- CI/CD automation reduces manual effort and risk.
- Staging environment and feature flags ensure smooth rollouts and minimize disruption.

**Alternatives considered**:
- **Serverless Deployment**: Rejected for the backend due to the need for a persistent SQLite database and background jobs.
- **Containerization (Docker)**: Deferred as it adds complexity to the initial setup, but can be adopted later for easier scaling and environment management.
