---
scope: File storage component of the backend infrastructure. This is a specialized approach for applications prioritizing decentralization and resilience.
kind: system
content_hash: 63a39a014c809ebee467978c752c30a4
---

# Hypothesis: Use Decentralized Storage (Storj/Filecoin) for File Uploads

For file storage, use a decentralized network like Storj or Filecoin. These platforms can offer higher durability and potentially lower storage costs compared to centralized providers. Files are sharded and distributed across a global network of nodes. The database would still be a managed relational or serverless DB. This is a more radical approach with potential benefits in resilience and cost, but with a less mature ecosystem.

## Rationale
{"anomaly": "Centralized cloud storage represents a single point of failure and can be expensive.", "approach": "Explore decentralized storage to increase resilience and potentially reduce costs, while accepting the trade-off of a less mature developer experience.", "alternatives_rejected": ["Building a custom distributed storage system (too complex)."]}