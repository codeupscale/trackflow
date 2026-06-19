# Single desktop session enforcement

**Status:** ✅ FIXED (2026-06-19, `staging`)

**Scope:** Backend auth + desktop agent — one active desktop login per account

**Severity:** P1 — same account could stay logged in on two desktop agents simultaneously (duplicate tracking, token confusion).

## Symptom

A user logs into the TrackFlow desktop app on machine A, then logs in on machine B with the same account. Both agents remain authenticated and can run timers / upload screenshots in parallel.

## Expected behavior

- **One desktop agent per account** — logging in on a second desktop revokes the first desktop’s tokens (first agent gets 401 on next API call → `forceLogout()`).
- **Web + desktop together is allowed** — web dashboard and one desktop agent can be logged in at the same time (Hubstaff-style).

## Root cause

Login issued Sanctum tokens without a client type. Every login (web or desktop) only pruned expired tokens, so multiple desktop agents could each hold a valid access/refresh pair.

## Fix

- Desktop agent sends `X-TrackFlow-Client: desktop` on login, org selection, and refresh (`desktop/src/main/api-client.js`).
- `AuthTokenService` tags tokens with `client:desktop` / `client:web` abilities and uses `desktop_*` token names for the agent.
- On **desktop** login, `revokeDesktopSessions()` removes prior desktop (and legacy untagged agent) tokens but **keeps** `client:web` sessions.
- Web login is unchanged — does not revoke an active desktop session.

## Verify

```bash
cd backend && php artisan test --filter=DesktopSingleSessionTest
```

Manual:

1. Log in on desktop A → start timer.
2. Log in on desktop B with same account.
3. Desktop A’s next heartbeat/API call should 401 and return to login.
4. Web session (if open) should still work.

## Intentional full revoke (unchanged)

Password change, admin reset, and account deletion still revoke **all** tokens (web + desktop).
