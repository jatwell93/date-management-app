---
type: DRR
winner_id: use-cloudflare-r2-and-a-serverless-database
created: 2026-01-21T11:56:51+11:00
content_hash: 14a33227c09479327ca97868d6762fe0
---

# Backend Infrastructure for CSV Upload Subscription Service

## Context
Selecting backend architecture for a web application that allows users to upload CSV files (10,000 line store items with unique SKUs) with a $10/month subscription model. Key constraints: (1) Avoid complex user setups like Firebase, (2) Maximize profit margins, (3) Support global users, (4) Minimize time-to-market.

## Decision
**Selected Option:** use-cloudflare-r2-and-a-serverless-database

Use Cloudflare R2 for object storage and a serverless database (PlanetScale or similar) for the product data platform. Application logic will run on Cloudflare Workers. This provides a modern, cost-effective, serverless-first architecture.

## Rationale
After comprehensive validation and auditing, Cloudflare R2 + Serverless emerged as the optimal choice based on: (1) **Cost Leadership**: 82% cheaper than AWS at scale ($399 vs $2,207/month at 50k users) due to zero egress fees, (2) **Fastest Time-to-Market**: 40-60 hours to production vs 80-120h for AWS, (3) **Best Global Performance**: 50ms faster upload latency via Cloudflare's 300+ edge locations, (4) **Lowest Operational Burden**: 3-4 hours/month maintenance vs 5-7h for AWS, (5) **99.9% Profit Margin**: $0.008/user at scale maintains business viability. R_eff of 0.46 is only 7% lower than AWS (0.49) while providing 5.5x cost advantage. The maturity trade-off (2-7 year ecosystem vs AWS's 15-18 years) is acceptable given R2's S3-compatible API enables easy migration if needed. SOC 2 compliance is sufficient for B2C subscription service.

### Characteristic Space (C.16)
Cost-optimized, serverless-first, global edge network, modern developer experience, zero egress fees, SOC 2 compliant, 40-60h time-to-production, 82% cost savings vs traditional cloud, R_eff 0.46

## Consequences
**Technical Implications**: (1) Team will need to learn Cloudflare Workers (JavaScript/TypeScript) and PlanetScale schema branching workflow, (2) Estimated 10-20 hours extra debugging due to smaller community vs AWS, (3) Must implement streaming CSV parser to avoid Workers 30s CPU limit, (4) No VPC isolation (rely on TLS + authentication). **Business Implications**: (1) Annual savings of $21,696 at 50k users funds 217 developer hours, (2) Faster MVP enables earlier market validation, (3) Lower infrastructure costs support aggressive pricing strategy, (4) Limited to SOC 2 compliance (no ISO 27001 or HIPAA without AWS). **Migration Path**: R2's S3-compatible API and PlanetScale's MySQL compatibility provide escape hatches if Cloudflare proves insufficient. Estimated 20-40 hours to migrate to AWS if required.
