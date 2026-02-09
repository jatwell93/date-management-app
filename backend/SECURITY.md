# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please email [security@yourproject.com](mailto:security@yourproject.com) or create a private security advisory through GitHub.

**Please do not report security vulnerabilities through public GitHub issues.**

We will acknowledge your report within 48 hours and provide a detailed response within 7 days.

---

## Security Exceptions & Risk Assessment

### Accepted Dependencies with Known Vulnerabilities

#### 1. tar (via sqlite3 dependencies)

**Vulnerability**: Path traversal and file overwrite issues in node-tar <=7.5.6
**Severity**: High  
**Status**: Accepted Risk  
**Justification**:
- Vulnerability affects build-time operations (npm install), not runtime
- Production environment uses Neon PostgreSQL (not SQLite)
- SQLite3 is development-only dependency
- Upgrading would require downgrading sqlite3 from 5.1.7 to 5.0.2 (not recommended)
- Risk: Low (no user-controlled file operations during installation)

**Mitigation**:
- Run `npm ci` in production (uses package-lock.json with verified checksums)
- Development machines regularly updated
- CI/CD pipelines use isolated environments

#### 2. xlsx (sheetjs-style)

**Vulnerability**: 
- Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
- Regular Expression Denial of Service (GHSA-5pgg-2g8v-p4x9)

**Severity**: High  
**Status**: Accepted Risk with Mitigations  
**Justification**:
- No fix available from package maintainers
- Used only for CSV/XLSX parsing of trusted user uploads (authentication required)
- Input sanitized before processing (CSV injection prevention implemented)
- Rate limiting applied to upload endpoints (10 uploads/hour)
- File size limits enforced (10MB max)

**Mitigation**:
- Input validation with zod schemas
- CSV injection sanitization (escapes `=`, `+`, `-`, `@` at cell start)
- Request size limits: 10MB payload
- Rate limiting: 10 uploads/hour per user
- Only authenticated users can upload files
- Uploaded files processed asynchronously (no blocking main thread)

**Risk Assessment**: Low-Medium
- Prototype pollution: Requires malicious file upload from authenticated user
- ReDoS: Mitigated by file size limits and rate limiting
- Impact limited to single user session (not system-wide)

**Monitoring**:
- Application logging tracks all file uploads with user ID
- Sentry error tracking monitors for parsing failures
- UBS (Ultimate Bug Scanner) runs pre-commit to catch code issues

---

## Security Measures Implemented

### 1. Authentication & Authorization
- JWT-based authentication with 1-hour access token expiry
- Refresh tokens (7-day expiry) with revocation support
- PIN validation (4-6 digits, prevents predictable patterns)
- bcrypt hashing (10 salt rounds) for PIN storage
- Token rotation support (JWT_SECRET_OLD for graceful rotation)

### 2. Input Validation
- Zod schemas for all API endpoints
- CSV injection prevention (sanitizes leading `=`, `+`, `-`, `@`)
- Request body size limit: 10MB
- File upload size limit: 10MB
- Barcode validation (alphanumeric, 8-14 characters)

### 3. Rate Limiting
- Strict: 5 requests/15min (login, register)
- Upload: 10 requests/hour (file uploads)
- Standard: 100 requests/15min (other endpoints)

### 4. CORS Security
- Environment-based whitelist
- Development: localhost:3000, localhost:3001
- Production: Configured via `CORS_ORIGINS` environment

variable

### 5. Database Security  
- Prisma ORM (prevents SQL injection)
- TLS/SSL required for Neon PostgreSQL (`sslmode=require`)
- Parameterized queries throughout
- Refresh token storage with expiry tracking

### 6. Error Handling
- Custom error classes (AuthenticationError, ValidationError, etc.)
- Global error handler middleware
- Structured error responses
- Sensitive data excluded from error messages
- All errors logged with correlation IDs

### 7. Secrets Management
- No hardcoded secrets in codebase
- `.env` files (excluded from git via `.gitignore`)
- git-secrets pre-commit hooks
- GitHub Actions secrets scanning
- Environment-specific configurations

### 8. Workers Edge Security
- JWT validation at edge using `jose` library
- Public key verification for tokens
- Request signing for backend communication
- 401/403 responses for invalid/expired tokens

---

## Security Audit Schedule

- **npm audit**: Weekly automated via GitHub Actions
- **Dependency updates**: Monthly review and updates
- **Code review**: All PRs require security review checklist
- **UBS scanning**: Pre-commit hook (no critical issues allowed)
- **Penetration testing**: Quarterly (planned)

---

## Security Best Practices for Contributors

1. **Never commit secrets**: Use environment variables
2. **Validate all inputs**: Use zod schemas
3. **Test security**: Write tests for auth, validation, rate limiting
4. **Follow principle of least privilege**: Minimize permissions
5. **Use parameterized queries**: Never concatenate SQL
6. **Log security events**: Authentication failures, authorization denials
7. **Run UBS before commit**: `ubs $(git diff --name-only)`
8. **Review dependencies**: Check npm audit before adding packages

---

## Contact

Security Team: [security@yourproject.com](mailto:security@yourproject.com)  
Emergency Contact: [urgent@yourproject.com](mailto:urgent@yourproject.com)

**Response Time**:
- Critical vulnerabilities: 24 hours
- High vulnerabilities: 48 hours
- Medium/Low vulnerabilities: 7 days
