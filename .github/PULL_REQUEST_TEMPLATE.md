## Scanner brand exception review

- [ ] If this PR changes scanner-specific UI behavior, I verified `scanner-brand-exceptions.md`
- [ ] Any new scanner brand exception includes approval status and approver
- [ ] If this PR changes logic implemented in both `workers/` and `backend/`, shared values live in `shared/domain/*` and a PostgreSQL/pglite vs SQLite conformance test covers matching rows and order
- [ ] If this PR changes schema, `backend/prisma/schema.prisma`, `backend/prisma/neon-sql/*.sql` (+ rollback), and `backend/src/migrations/` agree; production remains `npm run migrate:prod` / `prisma db push`
