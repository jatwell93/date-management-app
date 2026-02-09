# Security Policy

This document is for reporting security vulnerabilities in the Date Management Application. For security best practices and implementation details, see [docs/security.md](docs/security.md).

## Reporting a Vulnerability

If you discover a security vulnerability, please report it **privately** to the project maintainers. **Do not open a public GitHub issue** or discuss the vulnerability in public channels.

### How to Report

1. **Email**: security@example.com with:
   - Vulnerability title
   - Description of the issue
   - Affected component(s) or endpoint(s)
   - Steps to reproduce (if safe to share)
   - Potential impact
   - Suggested remediation (optional)

2. **GitHub Security Advisory** (if you have access):
   - Use [GitHub's security advisory feature](https://docs.github.com/en/code-security/security-advisories)
   - This creates a private report visible only to maintainers

### Example Report

```
Subject: [SECURITY] SQL Injection vulnerability in product search

Description:
I found a potential SQL injection vulnerability in the product search endpoint.

Component: GET /api/products/search?q=<input>

Steps to reproduce:
1. Send request: GET /api/products/search?q='); DROP TABLE products; --
2. Observe that the request is processed without validation

Impact:
Could allow unauthorized database manipulation

Suggested Fix:
Use parameterized queries (which I see you already do via Prisma, so this may be a false alarm)
```

## Response Timeline

We take security seriously and aim to respond to all vulnerability reports within these timeframes:

| Severity | Response Time | Intent |
|----------|---------------|--------|
| **Critical** | 24 hours | Immediate assessment and start of fix |
| **High** | 48 hours | Assessment and initial response |
| **Medium** | 7 days | Assessment and proposed fix |
| **Low** | 30 days | Triage and planning |

## Severity Classification

- **Critical**: Allows remote code execution, unauthorized data access, or systemic compromise
- **High**: Allows unauthorized actions affecting multiple users or sensitive data
- **Medium**: Affects limited users or requires special conditions to exploit
- **Low**: Security best practice improvement or low-impact issue

## Disclosure Process

1. **Private Report**: You report the vulnerability privately
2. **Acknowledgment**: We acknowledge receipt within 24 hours
3. **Assessment**: We assess severity and scope
4. **Remediation**: We develop and test a fix
5. **Release**: We release a patched version
6. **Disclosure**: We disclose the vulnerability (with credit if desired)
7. **Post-Mortem**: We document lessons learned (optional)

### Responsible Disclosure

- **Do not publicly disclose** the vulnerability until we've released a fix and had time to notify users
- **Do not exploit** the vulnerability beyond what's needed to demonstrate the issue
- **Do not access** data that isn't yours or that you're not authorized to access
- **Do provide** reasonable time for us to develop and release a fix (typically 90 days)

## Security Exceptions & Accepted Risks

See [backend/SECURITY.md](backend/SECURITY.md) for documentation of known vulnerabilities, accepted risks, and mitigation strategies.

## Security Best Practices for Users

- **Keep credentials safe**: Don't share your PIN with others
- **Use strong passwords**: For any associated accounts (email, cloud storage, etc.)
- **Enable MFA**: On any accounts that support it
- **Report suspicious activity**: Contact support immediately if you notice unusual access
- **Use HTTPS**: Always access the application over HTTPS in production
- **Update regularly**: Keep your browser and OS updated with latest security patches

## Security Best Practices for Developers

See [docs/security.md](docs/security.md) for comprehensive developer security guide, including:
- Input validation and sanitization
- Authentication and token management
- Rate limiting and CORS configuration
- Database security practices
- Error handling best practices
- Secrets management

## Bug Bounty Program

We currently do not have a formal bug bounty program, but we deeply appreciate security researchers who responsibly report vulnerabilities. Security reporters will receive:

- Recognition in release notes (if desired)
- Knowledge that their work helped protect users
- Gratitude from the team

In the future, we may establish a formal bug bounty program. Check back for updates.

## Security Checklist for Deployments

Before deploying to production:

- [ ] `DATABASE_URL` includes `sslmode=require`
- [ ] All secrets are in `.env` (not `.env.example`)
- [ ] `npm audit` shows no critical vulnerabilities
- [ ] `npm run lint` passes with no errors
- [ ] `npm test` passes with 80%+ coverage
- [ ] `npm run build` completes without errors
- [ ] Rate limiting is configured for production loads
- [ ] CORS whitelist includes only trusted origins
- [ ] Error handling is configured for production (generic messages)
- [ ] Git-secrets scanning is passing
- [ ] Security headers are enabled (Helmet.js)
- [ ] Logging does not contain sensitive data
- [ ] Monitoring/alerting is configured (Sentry)

## Dependencies & Vulnerability Management

We use `npm audit` to identify vulnerable dependencies:

```bash
# Check for vulnerabilities
npm audit

# Fix safe vulnerabilities automatically
npm audit fix

# Review remaining vulnerabilities
npm audit --audit-level=moderate
```

### Current Vulnerability Status

To check the current status of known vulnerabilities, see:
- `npm audit` output
- [backend/SECURITY.md](backend/SECURITY.md) for documented exceptions

## Security Contact

For security matters, contact: **security@example.com**

For general questions or non-security issues, use GitHub issues or discussions.

## Acknowledgments

We thank all security researchers and community members who responsibly disclose vulnerabilities and help us keep this project secure.

---

**Last Updated**: February 9, 2026  
**Status**: Active
