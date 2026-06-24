# Idle popup auto-stop countdown shows absurd values (e.g. 8584:14)

**Status:** ✅ FIXED 2026-06-19 (staging); ✅ Round 2 FIXED 2026-06-24 (`develop`) — different
root cause (misconfigured org setting + no cap), see below.
**Severity:** P1 — misleading UX; users think timer/web are broken
**Scope:** Desktop idle alert renderer + `showIdleAlert()` payload

## Symptom

Idle alert footer shows nonsense like **"Timer will auto-stop in 8584:14"** while idle time displays correctly (e.g. `00:20:46`). Web dashboard correctly shows **Paused · 3:50:01** (frozen work session) — users compare the two and think sync is broken.

## Root cause

**Two different metrics (not a sync bug):** web shows frozen **project work time**; idle popup shows **keyboard/mouse idle duration**. Those numbers are expected to differ.

**Real bug — countdown math mismatch:**

| Layer | Auto-stop logic |
|-------|-----------------|
| `idle-detector.js` `_checkAutoStop()` | Fires when `(now - alertShownAt) >= alertAutoStopSec` (grace period **after popup is shown**) |
| `idle-alert.js` (broken) | `remaining = (idleTimeoutSec + alertAutoStopSec) - idleElapsed` (measured from **idle start**) |

When the user was idle long before the popup appeared, `idleElapsed` can exceed `idleTimeout + grace`, producing huge bogus `remaining` values (8584+ minutes).

## Fix

- Main process sends `alertShownAt` (ms) + `autoStopGraceSec` instead of `autoStopTotalSec`.
- Renderer computes `remaining = alertShownAt + grace - now`, matching `IdleDetector._checkAutoStop()`.
- Normalize `idleStartedAt` via `Date.parse` when IPC delivers an ISO string.

## Round 2 (2026-06-24) — absurd countdown returns via a misconfigured org setting

QA saw **"Timer will auto-stop in 8597:40"** again. This time the countdown MATH was correct;
the **grace value itself** was absurd: the org setting `idle_alert_auto_stop_min` was **8600**
(≈ 6 days), so `alertAutoStopSec = 8600 × 60`. The backend `SettingsController` validated this
field as `min:1|max:10080` (7 days), allowing the bad value.

**Fix (defense-in-depth, all OSes):**
- **Desktop cap:** `IdleDetector._applyConfig()` clamps `idle_alert_auto_stop_min` to
  `[0, MAX_AUTO_STOP_MIN=240]` (4 hours) so no server value can ever produce an absurd
  countdown / never-auto-stopping timer.
- **Backend validation:** `SettingsController` max lowered `10080 → 240`.
- **Data fix:** the affected org setting was corrected `8600 → 240` in the DB.

## Key files

- `desktop/src/main/index.js` — `buildIdleAlertPayload()`, `showIdleAlert()`
- `desktop/src/main/idle-detector.js` — `_applyConfig()` 4h cap (`MAX_AUTO_STOP_MIN`)
- `desktop/src/renderer/idle-alert.js` — countdown tick
- `backend/app/Http/Controllers/Api/V1/SettingsController.php` — `idle_alert_auto_stop_min` max 240
- `desktop/test/idle-autostop-countdown.test.js`, `desktop/test/idle-detector.test.js`
