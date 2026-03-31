---
name: security
description: "Delegate security tasks to the security-engineer agent. Phase 5 in the pipeline — runs AFTER all tests pass, BEFORE code review. Produces PASS or NEEDS_FIX verdict. Use for OWASP audits, auth issues, multi-tenancy checks, CORS/CSP, secrets management, Electron security, or dependency vulnerability scanning."
---

# Security Engineer

Delegate this task to the `security-engineer` agent using the Agent tool with `subagent_type: "security-engineer"`.

## Scope

- Authentication & authorization (Sanctum, roles, policies)
- Input validation and sanitization
- CORS configuration (`backend/config/cors.php`)
- CSP and security headers (`backend/app/Http/Middleware/SecurityHeaders.php`)
- Secrets management (tokens, API keys, encryption)
- Vulnerability assessment (OWASP Top 10)
- Desktop security (`contextIsolation`, `sandbox`, IPC safety)
- Audit logging (`backend/app/Services/AuditService.php`)

## Rules the agent follows

- Defense in depth: auth + RBAC + org-scoping + rate limiting + validation
- Every query scoped by `organization_id` (P0 if missing)
- Token storage: AES-256-GCM on desktop, short-lived tokens (24h access, 30d refresh)
- Never expose internal errors to clients
- Run `composer audit` and `npm audit` to check dependencies

## Invocation

```
/security <describe the security task>
```
