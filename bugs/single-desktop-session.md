# Single desktop session enforcement

**Status:** ✅ FIXED (2026-06-22, `develop`) — superseded the 2026-06-19 reject-based approach

**Scope:** Backend auth + desktop agent — one desktop machine per account

**Severity:** P0 — the original reject-based design could permanently lock a user out.

## Symptom

1. After uninstalling / force-killing the desktop app on **both** machines (no Sign Out
   clicked), the backend kept reporting **"already logged in on another desktop"** and
   refused every new desktop login — for up to 30 days (refresh-token TTL).
2. Closing / uninstalling / force-killing the app did **not** stop the timer server-side:
   the open entry kept counting `started_at → now()` on the web dashboard.

## Root cause

The first cut (2026-06-19) enforced "one desktop" by **rejecting** the second login with
`409` whenever an active desktop token *or* an open timer existed for the account. Neither
check asked whether that session was still **alive** — and the whole design assumed the
client always logs out cleanly on exit. Uninstall / crash / force-kill never run the
`before-quit` cleanup, so the desktop refresh token (30d) **and** the open timer were left
behind with no client able to clear them → permanent lockout + a timer that never stops.

A latent bug compounded it: [`isDesktopToken()`](../backend/app/Services/AuthTokenService.php)
classified tokens with `$token->can('client:web')`, but the desktop **access** token carries
the `*` ability, so `can('client:web')` returned `true` (wildcard) and the access token was
misclassified as web — so it would not have been revoked even when we tried.

## Fix — last-login-wins + reclaim (client directive, 2026-06-22)

On every desktop sign-in (email, Google, org-selection — all via `issueTokensAndRespond()`),
[`AuthTokenService::terminatePreviousDesktopSessions()`](../backend/app/Services/AuthTokenService.php):

- **Closes any open timer** via `TimerService::closeStaleOpenTimer()`, ending it at the
  **last heartbeat** (or `started_at` when none). The dead/phantom tail after the agent
  stopped reporting is **discarded — never counted**. Real tracked time (up to the last
  heartbeat, 30s granularity) is kept.
- **Revokes every previous desktop token** for the account, on any device. The prior
  machine's next request `401`s and it logs itself out. There is **no more `409`** — a new
  desktop always wins, so a crash/uninstall can never lock the user out.
- **Web sessions are left untouched** (web + one desktop still coexist).

`isDesktopToken()` now matches abilities **literally** (`in_array('client:desktop', …)`),
never via `can()`, so the `*`-bearing access token is classified and revoked correctly.

## Offline / non-tracked time decision

We discard only the **phantom tail** (time after the last server-received heartbeat). We do
**not** wholesale-delete legitimately tracked time. A session being terminated by a new login
is over; if a now-abandoned machine later flushes queued offline events for that entry, the
existing sync protocol swallows them (404-on-stop = success; a heartbeat on a closed entry is
dropped).

## Catch-all when the user never logs back in

The login reclaim only fires on the next desktop login. For close/uninstall **without** a
re-login, the scheduled safety nets close the orphaned entry: `timer:cleanup-stale`
(30 min, every 5 min) and `CloseStaleTimerEntriesJob` (2 h, every 30 min). **These require the
Laravel scheduler to be running in production** (`schedule:run` / Horizon). Verify it is.

## Verify

```bash
cd backend && php artisan test --filter=DesktopSingleSessionTest
```

Manual:

1. Log in on desktop A → start timer.
2. Log in on desktop B with the same account → **B logs in successfully**; A's next API call
   401s and A logs out; the open timer is closed at A's last heartbeat.
3. Web dashboard session remains unaffected.

## Intentional full revoke (unchanged)

Password change, admin reset, and account deletion revoke **all** tokens.
