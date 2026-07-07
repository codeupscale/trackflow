# Idle detection could be fully disabled (`idle_timeout = 0`)

**Status:** ✅ FIXED (2026-07-07)
**Severity:** P2 — product policy: idle monitoring must always be active
**Scope:** Web settings, backend validation/API, desktop `IdleDetector`, DB migration

## Symptom

Org admins could set **Idle detection → Never (disabled)** (`idle_timeout = 0`). Desktop stopped idle monitoring entirely — no popup, no pause, no idle time handling.

## Root cause

- Web settings exposed `SelectItem value="0"` (“Never (disabled)”).
- Backend validated `idle_timeout` as `min:0|max:30`.
- `AgentController` set `idle_detection: false` when `idle_timeout <= 0`.
- Desktop `IdleDetector` set `enabled = false` when `idleTimeoutSec === 0`.

## Fix

- Removed “Never (disabled)” from web settings; save clamps to `min:1`.
- Backend validation `min:1|max:30`; migration backfills stored `0` → `5`.
- `AgentController` always returns `idle_detection: true` and clamps timeout to `[1, 30]`.
- Desktop floors `idle_timeout <= 0` to **1 minute** (defense in depth).

## Related settings (NOT disabled — different behavior)

| Setting                                    | Effect                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| **When idle is detected → Always keep**    | Idle is still **detected**; popup skipped; idle time auto-kept      |
| **When idle is detected → Always discard** | Idle is still **detected**; popup skipped; idle time auto-discarded |
| **Idle alert auto-stop → Off**             | Popup stays until user acts; idle **detection** still runs          |

These do not turn off idle detection — only change what happens after the threshold is crossed.

## Key files

- `web/src/app/(dashboard)/settings/page.tsx`
- `backend/app/Http/Controllers/Api/V1/SettingsController.php`
- `backend/app/Http/Controllers/Api/V1/AgentController.php`
- `backend/database/migrations/2026_07_07_000002_enforce_minimum_idle_detection_timeout.php`
- `desktop/src/main/idle-detector.js`
