# Tenant request authentication v2

## Contract

The backend serializes the Orchestrator request body once, computes SHA-256 over the exact UTF-8 bytes, and signs:

POST:/v1/chat/completions:{organization_id}:{timestamp}:{nonce}:{body_sha256}

It sends the digest in X-Tenant-Body-SHA256 and the HMAC in X-Tenant-Signature. The Orchestrator recomputes the hash from the raw HTTP request body before consuming the nonce or calling a provider. This binds the tenant identity, HTTP method, endpoint, timestamp, nonce and request body together.

## Compatibility rollout

The Orchestrator includes TENANT_BODY_SIGNATURE_REQUIRED=false by default. During this compatibility period:
- v2 requests with X-Tenant-Body-SHA256 are verified against the exact raw body and v2 HMAC.
- legacy v1 requests without the body-hash header remain accepted.
- a supplied but incorrect body hash is always rejected.

Deploy in this order:

1. Deploy the Orchestrator v2 code with TENANT_BODY_SIGNATURE_REQUIRED=false.
2. Deploy the backend code that sends v2 signatures.
3. Run the simple, complex, tenant-context and real inbound WhatsApp smoke tests.
4. Only after confirming every caller sends v2, set TENANT_BODY_SIGNATURE_REQUIRED=true in Railway and redeploy the Orchestrator.
5. Keep legacy v1 scripts/callers disabled after enforcement is enabled.

Do not enable the enforcement flag before the backend v2 code is live, or existing backend calls will receive HTTP 401.

## Test coverage

- Valid v2 signature.
- Different tenant, method, path or body hash invalidates the signature.
- Raw body tampering returns TENANT_BODY_HASH_MISMATCH.
- Missing body hash is rejected when enforcement is enabled.
- Legacy v1 remains accepted only during the staged compatibility period.
