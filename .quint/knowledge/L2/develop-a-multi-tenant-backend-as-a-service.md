---
scope: The entire application architecture and delivery model. Suitable for a B2C or B2B SaaS product.
kind: system
content_hash: b22c8c779c514cb0a343e3ff2d6306db
---

# Hypothesis: Develop a Multi-Tenant Backend as a Service

Develop a fully managed, multi-tenant backend service. Users sign up for an account on our platform. All data is stored and managed by our backend, with clear separation between tenants. Users interact with the service through a simple web interface for uploading files and managing their data, with no need for any infrastructure setup on their part. This is the classic SaaS model.

## Rationale
{"anomaly": "Users have to manage their own infrastructure.", "approach": "Abstract all backend complexity behind a managed service, providing a simple UI for users. This is the most common and understood model for SaaS products.", "alternatives_rejected": ["Requiring users to deploy their own instance of the backend (this is the current problem)."]}