# Screenshot activity percentage incorrect (capture-window misalignment + display fallback)

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #3 (P1). Desktop capture-side + backend display-side.

**Scope:** Desktop activity monitor (`desktop/src/main/activity-monitor.js`) and backend screenshot display path (`backend/app/Http/Controllers/Api/V1/ScreenshotController.php`, new `backend/app/Support/ScreenshotActivity.php`).

**Severity:** P1 — activity % shown next to screenshots is wrong, undermining trust in monitoring data.

## Symptom

QA (Employee role) examples:
- (a) screenshot captured with 0 mouse + 0 keyboard input shows **14%** activity.
- (b) another 0 mouse + 0 keyboard correctly shows **0%**.
- (c) 0% mouse + 4% keyboard shows **0%** activity.

## Root cause

Two independent defects, both about attributing the WRONG activity window to a screenshot:

1. **Desktop capture side (primary cause):** `getScoreForScreenshot()` returned `_lastCompletedIntervalScore` — the score of the **previous completed 30s heartbeat interval**, not the window ending at capture time. A screenshot taken during a quiet moment could inherit a busy earlier interval's score (→ 14% with no current input), and light current input could be dropped because it belonged to the not-yet-completed interval (→ 0%). Misalignment of up to a full 30s interval.

2. **Backend display side (secondary):** In `ScreenshotController@index`,
   - when `activity_score_at_capture` was null it fell back to `timeEntry->activity_score` — the entry's **overall EMA aggregate** — producing a nonzero % for a genuinely idle capture ("0+0 shows 14%" on display).
   - `batchLoadActivityLogs` matched the nearest `ActivityLog` within **±10 minutes**, attributing a completely different window's keyboard/mouse counts to the screenshot.

## Fix

**Desktop (`activity-monitor.js`):**
- Introduced a rolling trailing-window set of active seconds (`_rollingActiveSeconds`) that persists **across** heartbeat intervals.
- Screenshot score is now the percentage of active seconds over the **30s window ending exactly at capture time**, with warmup handling for sessions shorter than the window.
- Both input paths — the `uiohook` path and the `powerMonitor` fallback path — feed the window via `_markActiveSecond()`, so the score is consistent regardless of capture backend.

**Backend:**
- Activity resolution centralized in new `App\Support\ScreenshotActivity`; the list endpoint and the broadcast event use identical logic.
- Null `activity_score_at_capture` now derives from the matched window's log, else 0 — **never** the entry aggregate.
- `batchLoadActivityLogs` match window tightened from ±10 min to **±60s** (one 30s heartbeat + clock skew).

## Payload contract (for reference)

Desktop stores `activity_score` **verbatim** into `screenshots.activity_score_at_capture` (no server math). Screenshot presign/confirm payload: `{ time_entry_id, captured_at (ISO), file_size, idempotency_key, app_name?, window_title?, activity_score? (int 0-100, trailing 30s ending at captured_at), display_index?, display_count? }`. Heartbeats (every 30s + final on stop): `{ keyboard_events, mouse_events, active_seconds (0-30), active_app, active_window_title, active_url:null }`; offline-queued ones add `logged_at + time_entry_id + idempotency_key`. If the backend recomputes per-screenshot activity it aggregates heartbeat active-seconds overlapping `[captured_at - 30s, captured_at]`.

## Key files

- `desktop/src/main/activity-monitor.js` — `_rollingActiveSeconds`, `_markActiveSecond()`, `getScoreForScreenshot()`.
- `backend/app/Support/ScreenshotActivity.php` (new), `backend/app/Http/Controllers/Api/V1/ScreenshotController.php`.

## Verification

- Desktop: `cd desktop && npx jest` → 519/519 (new `test/activity-score.test.js`).
- Backend: `cd backend && ./vendor/bin/phpunit -c phpunit.local.xml --filter=Screenshot` → 21/21 (60 assertions).

## Follow-up / QA note

Capture-side accuracy verified via unit tests; recommend a targeted manual QA pass correlating on-device input to displayed % across a few captures.
