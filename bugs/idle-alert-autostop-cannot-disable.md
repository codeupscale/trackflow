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
