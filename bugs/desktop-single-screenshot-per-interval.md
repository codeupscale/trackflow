# Desktop — only one screenshot per interval (no Hubstaff-style multi-capture)

**Area:** Desktop agent — screenshot cadence
**Severity:** P2 (monitoring coverage gap / product parity)
**Status:** ✅ FIXED (2026-08-03, `develop`)

## Symptom

QA: "screenshots are not taken on an interval — only 1 screenshot each 15 minutes on the
dashboard." Expected multiple randomized screenshots per window, like Hubstaff / Time
Doctor.

## Root cause — design, not glitch

`ScreenshotService._startInterval()` (`desktop/src/main/screenshot-service.js`) scheduled
**exactly one** capture per `screenshot_interval` (default 5 min), at a random point in
the 60–100% band of the interval. If the org's `screenshot_interval` was 15, the agent
produced one shot per 15 minutes — working as written. There was no concept of "N shots
per window." (Uploads are also batched on the 10-min sync flush, so the dashboard lags by
up to one interval — that is expected and separate.)

## Fix — N random shots per interval window

- New config `screenshots_per_interval` (default **3**, agent-clamped to `[1,10]`).
  Served by `GET /agent/config`, editable via `PUT /settings`, defaulted in
  `Organization::getDefaultSettings()`. Backward compatible — the agent defaults to 3
  when the backend omits it.
- `_startInterval()` rewritten into a **per-window scheduler**: each window fires
  `_shotsPerWindow()` captures at random moments spread across the window. Offsets come
  from the pure helper `randomOffsetsAcrossWindow(count, windowMs, rng)`, which splits the
  window into `count` equal sub-slots and picks one uniform-random instant in each —
  spread (no clustering) yet unpredictable. Windows are back-to-back and re-randomize.
- Per-shot timers are tracked in `_shotTimers` (separate from the window-boundary
  `_intervalTimer`) and cancelled by `stop()` and the failure-pause path, so a
  logout / project switch / idle pause can't fire a capture against a stale entry.
- Each capture keeps its own `idempotency_key`, so the extra shots are not deduped; on
  multi-monitor each shot still fans out to one image per display.

## Verification

- `desktop/test/screenshot-service.test.js` — 7 new tests: helper spread/bounds/clamp,
  default-count-per-window, configured count, max clamp, and stop()-cancels-pending.
- Full desktop suite green (773 tests).

## Follow-ups

- Verify the dev org's `screenshot_interval` / `screenshots_per_interval` values and that
  the offline-queue flush + backend presign are not collapsing captures (each shot has a
  unique idempotency key, so they should not).
