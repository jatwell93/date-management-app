# Backend Architecture Patterns (Technical Debt Remediation)

This document outlines the architectural patterns introduced during the technical debt remediation phase.

## 1. Controller Pattern

All route handlers should delegate to a Controller class. Controllers are responsible for:

- Extracting parameters from the request.
- Delegating business logic to Services.
- Throwing domain errors (instead of manual response manipulation).
- Formatting the final response.

Location: `backend/src/controllers/`

## 2. Service Pattern

Services contain the core business logic. They should:

- Be stateless regarding tenant context (prefer passing `organizationId` to methods or injecting it).
- Use Repositories for data access.
- Be decorated with `@injectable()` for Dependency Injection.

Location: `backend/src/services/`

## 3. Repository Pattern

Repositories handle all data access logic (e.g., Prisma calls). They should:

- Be the only place where Prisma is directly used for routine CRUD.
- Support optional transaction context by accepting a `DbClient` (PrismaClient or TransactionClient).

Location: `backend/src/repositories/`

## 4. Dependency Injection (DI)

We use `tsyringe` for Dependency Injection.

- Composition Root: `backend/src/di/container.ts`
- Service Factories: `backend/src/di/services.ts`

Always use the DI container to resolve controllers in the route files.

## 5. Error Handling

Use centralized error handling middleware. Throw custom domain errors from `backend/src/errors/`:

- `NotFoundError`
- `ValidationError`
- `AuthenticationError`
- `AuthorizationError`
- `ConflictError`

## 6. Structured Logging

Use the centralized `Logger` utility in `backend/src/utils/logger.ts` for all logging.
Avoid using `console.log` directly in production code.
