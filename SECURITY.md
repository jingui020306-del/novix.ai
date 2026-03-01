# Security Policy

## Reporting a vulnerability

Please do **not** post secrets, private keys, or full exploit details in public issues.

If you discover a security issue:

1. Use GitHub Security Advisories / private reporting when available.
2. Include impact, reproduction steps, and affected paths.
3. Share minimal proof-of-concept data (sanitized).

## Scope notes

- API keys and provider credentials should stay in environment variables.
- Demo data under `data/demo_project_001/` must not contain real secrets.
- Issues that are network-policy related (`npm E403`, proxy restrictions) are usually environment configuration, not app vulnerabilities.
