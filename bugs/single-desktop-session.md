# Single desktop session enforcement

**Status:** ✅ FIXED (2026-06-19, `develop`)

**Scope:** Backend auth + desktop agent — one desktop machine per account

**Severity:** P1 — same account could sign in on two desktop agents at once.

## Symptom

A user logs into the desktop app on machine A, then signs in on machine B with the same account. Both agents stay authenticated (or the second login steals the first session).

## Expected behavior

- **One desktop machine per account** — a second desktop **cannot log in** while another desktop session exists (HTTP 409).
- **Timer running** — if a timer is open for the account on desktop A, desktop B **cannot log in** until the timer is stopped and the user logs out on A.
- **Web + one desktop** — still allowed.
- **Same machine re-login** — allowed (stable `X-Device-Id` from `.device-key`).

## Fix

- Desktop sends `X-TrackFlow-Client: desktop` and `X-Device-Id` (SHA-256 of persisted device secret).
- `AuthTokenService::assertDesktopLoginAllowed()` returns **409** when another desktop session or open timer blocks login (login is rejected, not a silent token steal).
- Tokens store `device:{id}` in Sanctum abilities for binding.
- Covers email login, Google OAuth, and org selection — all flow through `issueTokensAndRespond()`.

## Verify

```bash
cd backend && php artisan test --filter=DesktopSingleSessionTest
```

Manual:

1. Log in on desktop A → start timer.
2. Try to log in on desktop B → login form shows error; B stays logged out.
3. Stop timer and log out on A → B can log in.
4. Web dashboard session remains unaffected.

## Intentional full revoke (unchanged)

Password change, admin reset, and account deletion revoke **all** tokens.
