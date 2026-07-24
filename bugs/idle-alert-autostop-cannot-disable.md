# Idle alert auto-stop cannot be disabled (max 4h mistaken for "off")

**Status:** ✅ FIXED (2026-07-07)
**Severity:** P2 — org admins expect to disable popup auto-stop; 240 min cap still stops timer
**Scope:** Web settings, backend validation, desktop `IdleDetector`

## Symptom

Org admin disables or minimizes idle popup auto-stop in Settings, expecting the timer to stay paused on the idle alert until the user acts. Timer still auto-stops after **4 hours** (or after **10 minutes** if the desktop never picked up a saved change).

Help text in the idle popup: "Timer will auto-stop in …" — users interpret turning auto-stop "off" as removing this behavior entirely.

## Root cause

1. **No disable value:** `idle_alert_auto_stop_min` validated `min:1|max:240`. Desktop already treated `0` as disabled, but the API and web UI never allowed saving `0`.
2. **Frontend clamped to ≥1:** `settings/page.tsx` used `Math.max(1, …)` on save and allowed input up to `10080` (backend rejected >240).
3. **240 ≠ off:** After the 2026-06-24 cap fix, orgs with absurd values were clamped to **240 minutes (4 hours)** — the maximum grace, not disabled. Admins who raised the value to "turn off" 10-minute auto-stop still get a 4-hour auto-stop + notification.
4. **Config lag:** Desktop re-fetches org config every ~5 minutes during timer sync; a just-saved setting may not apply until refetch or app restart.

## Fix

- Backend: `idle_alert_auto_stop_min` validation `min:0|max:240` (`0` = disabled).
- Web settings: **Switch** to enable/disable auto-stop; minutes input only when enabled (1–240).
- Desktop: guard `_checkAutoStop()` when `alertAutoStopSec <= 0`; `updateConfig()` clears auto-stop interval when disabled mid-alert.

## Note (separate policy)

Server `timer:cleanup-stale` may still close open entries with no heartbeat after `offline_grace_minutes` (default 4h). Idle pause stops heartbeats, so a popup left open for many hours without user action can still be closed by server cleanup — distinct from idle popup auto-stop.

## Key files

- `backend/app/Http/Controllers/Api/V1/SettingsController.php`
- `web/src/app/(dashboard)/settings/page.tsx`
- `desktop/src/main/idle-detector.js`
- `desktop/test/idle-detector.test.js`

## Follow-up (2026-07-23) — idle alert now NEVER auto-dismisses

**Product decision:** the idle alert must stay visible until the user explicitly picks
*Continue Tracking* or *Stop Timer* — no auto-dismiss at all. This supersedes the
per-org interactive countdown AND removes the fixed 10-min hard-stop grace
(`DEFAULT_HARD_STOP_GRACE_SEC`) that the "12h phantom" sleep/idle work had re-introduced.

- `IdleDetector._applyConfig()` now forces `alertAutoStopSec = 0` and
  `hardStopGraceSec = 0` (the `idle_alert_auto_stop_min` org setting is ignored).
  `_checkAutoStop()` guards both fires with `> 0`, so neither ever fires — `ALERTING`
  terminates only on an explicit user action (or the sleep/suspend path).
- **Why this is billing-safe without any cap:** the timer is server-paused the instant
  idle is *detected* — `pauseTimerForIdle()` calls `POST /timer/pause` back-dated to
  `idleStartedAt` and halts heartbeats + screenshots. Server elapsed is frozen at
  idle-start for the whole time the alert waits, so an unanswered alert credits **no**
  additional idle/tracked time. The old "12h phantom" hole is closed by the pause, not by
  the auto-stop cap.
- Renderer countdown UI auto-hides when `autoStopGraceSec <= 0` (main now sends `0`).
- Tests: `desktop/test/idle-detector.test.js` rewritten to assert never-dismiss
  (auto-stop never fires; alert stays `ALERTING` past any former threshold). 80/80 idle
  tests green.

**Separate policy still applies:** the server `timer:cleanup-stale` job can still close an
open entry after `offline_grace_minutes` (~4h) because idle pause stops heartbeats. The
desktop window stays visible indefinitely, but a many-hours-unanswered entry may be closed
server-side (back-dated to last heartbeat — billing-safe); a late Continue/Stop then
reconciles against the closed entry. Distinct from desktop idle auto-stop.
