# Idle popup auto-stop countdown shows absurd values (e.g. 8584:14)

**Status:** ✅ FIXED 2026-06-19 (staging)
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

## Key files

- `desktop/src/main/index.js` — `buildIdleAlertPayload()`, `showIdleAlert()`
- `desktop/src/renderer/idle-alert.js` — countdown tick
- `desktop/test/idle-autostop-countdown.test.js`
