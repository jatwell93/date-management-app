---
scope: Backend infrastructure for file storage and database, focused on cost-optimization and serverless architecture.
kind: system
content_hash: 56c3e2ba31f0234ec1cd4227e81cb681
---

# Hypothesis: Use Cloudflare R2 and a Serverless Database

Utilize Cloudflare R2 for object storage to handle large file uploads, benefiting from its zero egress fee model which can be highly cost-effective. For the database, use a modern serverless SQL database like PlanetScale, Neon, or Cloudflare's own D1. This combination offers a potentially lower-cost, highly scalable, and developer-friendly stack.

## Rationale
{"anomaly": "Traditional cloud storage like S3 can have high egress costs.", "approach": "Adopt a modern, cost-effective stack by using Cloudflare R2 to eliminate egress fees and a serverless database to reduce operational overhead.", "alternatives_rejected": ["Self-hosting MinIO (adds operational complexity)."]}