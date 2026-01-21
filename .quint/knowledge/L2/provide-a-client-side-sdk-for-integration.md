---
scope: The developer-facing part of the product. This is for a platform-as-a-service (PaaS) offering.
kind: system
content_hash: 3bbfe8a0c13c7298213632b7a54978e3
---

# Hypothesis: Provide a Client-Side SDK for Integration

Provide a client-side SDK (e.g., a JavaScript library or npm package) that developers can integrate into their own applications. The SDK will provide simple functions to upload data to our managed backend. This abstracts away the complexities of API calls, authentication, and file chunking. This model targets developers who want to use our service as a backend component.

## Rationale
{"anomaly": "Developers have to write boilerplate code to interact with our backend.", "approach": "Provide a developer-friendly SDK to simplify integration, reducing the time and effort required to use our service.", "alternatives_rejected": ["Only providing API documentation (higher friction for developers)."]}