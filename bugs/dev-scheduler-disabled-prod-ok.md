# Environment note: scheduler is ON in prod, OFF in dev (by design)

**Status:** ℹ️ REFERENCE (verified live 2026-06-22) — not a bug.

**Why this matters:** Several timer fixes rely on the Laravel scheduler as the
**offline-cleanup backstop** — `timer:cleanup-stale` (every 5 min) and
`CloseStaleTimerEntriesJob` (backstop), which close orphaned/offline timers (e.g. after an
uninstall/crash with no re-login) and enforce the ~4h offline grace window. See
[offline-online-sync-hardening.md](offline-online-sync-hardening.md) and
[uninstall-stop-timer-cross-platform.md](uninstall-stop-timer-cross-platform.md).

## Verified state (server `trackflow` = 13.250.184.114, ubuntu, key ~/.ssh/usama)

**PROD (`infra-tf-*`) — scheduler RUNNING ✅**
- Scheduler container command: `while true; do php artisan schedule:run --no-interaction; sleep 60; done`.
- Live logs show `timer:cleanup-stale`, `idle-detection`, and a per-minute `scheduler-heartbeat` firing.
- Horizon is up (critical/high/default/low/screenshots supervisors).
- → The offline-work cleanup + 4h-grace backstop **run in production**. Release-safe on this front.

**DEV (`infra-tf-dev-*`) — scheduler DISABLED by design ⚠️**
- Dev scheduler container is a deliberate no-op:
  `echo dev-scheduler-disabled-to-protect-prod-recipients; exec tail -f /dev/null`
  (keeps the dev env from sending notifications to prod recipients).
- → On **dev**, `timer:cleanup-stale` / `CloseStaleTimerEntriesJob` **do not run**.

## Practical implication for QA / future debugging

The scheduler dependency repeatedly flagged in the timer fixes is **satisfied in prod —
verified live**. But if QA validates the **"uninstall stops the timer after a delay"** scenario
(or any scheduled-cleanup behavior, including the ~4h offline-grace close) on the **dev**
environment, the scheduled backstop is **off there by design**:

- On **dev**, an orphaned/offline timer is only closed by the **login reclaim** (last-login-wins,
  closes the open timer on next desktop sign-in) or the desktop's **client-side stop paths**
  (graceful quit, power suspend, self-removal watcher) — **not** by the scheduler.
- Validate the scheduled-backstop path against **prod**, or temporarily enable cleanup on dev
  (see below). Don't conclude "the cleanup is broken" from dev behavior — check prod.

## If QA needs to validate the full backstop on dev

Options (pick one; dev box, containers `infra-tf-dev-*`):

- Run the cleanup once, manually, in the dev app container:
  `docker exec infra-tf-dev-app-1 php artisan timer:cleanup-stale`
- Or temporarily run the scheduler loop in the dev app container for a session:
  `docker exec -d infra-tf-dev-app-1 sh -c 'while true; do php artisan schedule:run --no-interaction; sleep 60; done'`
  (remember the "protect prod recipients" reason it's disabled — don't leave mail-sending
  scheduled tasks running long-term on dev).

## Open question for the team (not blocking)

Leave dev as-is, or temporarily enable the dev scheduler / run `timer:cleanup-stale` manually so
QA can validate the full offline backstop on dev? Default: leave it; validate the scheduled path
on prod.
