---
scope: Backend infrastructure for file storage and database. Applies to cloud-native application development.
kind: system
content_hash: 777a87ecc1cf7d160c197d5c7f4fc211
---

# Hypothesis: Use AWS S3 and RDS for File Storage and Database

Use AWS S3 for storing large file uploads (like CSVs) and a managed relational database like AWS RDS (PostgreSQL or MySQL) or Aurora for storing product data. The backend application will handle securely uploading files to a private S3 bucket and processing them to populate the RDS database. This is a robust, scalable, and industry-standard approach.

## Rationale
{"anomaly": "Firebase is not a good fit for a managed service.", "approach": "Leverage a mature and scalable cloud infrastructure stack (AWS) to provide a reliable and performant backend.", "alternatives_rejected": ["Using a single server with local storage (not scalable)."]}