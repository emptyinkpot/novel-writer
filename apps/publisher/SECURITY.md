# Security

This repository may operate browser profiles, cookies, and account sessions.

Never commit:

- cookies
- private keys
- API keys
- browser profile directories
- screenshots containing account data
- runtime state under `.runtime/`
- local operator logs

The repository is private by default because Fanqie automation code and account
handling are operationally sensitive.

Service API authentication is not implemented in the initial skeleton. Do not
expose this service outside a trusted local network until an auth layer is
added.

The default driver can launch a real browser profile and persist cookies. Treat
`FANQIE_SERVICE_DATA_DIR`, `FANQIE_SERVICE_ROOT`, and any paths referenced by
account `meta.browserDir` / `meta.cookiesFile` as sensitive runtime storage.
