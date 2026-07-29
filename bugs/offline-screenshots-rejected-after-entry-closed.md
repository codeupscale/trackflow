# Screenshots from offline-tracked time never arrive (presign 422s a closed entry)

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P1 — silent, permanent data loss. Time tracked offline shows up with missing (often
all) screenshots, which is exactly the evidence a monitoring product exists to provide.
**Scope:** `backend/.../ScreenshotController::presign()`, `desktop/src/main/offline-queue.js`,
`desktop/src/main/screenshot-service.js`.

## Symptom (owner, 2026-07-28)

> "when the tracked time is done offline, the last screenshot taken on desktop app does not come"

## Root cause 1 — the API rejects the backfill, and the queue treats that as permanent

Screenshots captured while offline are written to disk and queued; they can only be uploaded
**after** reconnect — by which time the session has usually been stopped. `presign()` allowed
uploads only to a live entry:

```php
$isActive = $timeEntry->ended_at === null
    || $timeEntry->ended_at->greaterThan(now()->subMinutes(5));
if (!$isActive) { return 422 'Screenshots can only be uploaded to active time entries.'; }
```

A 5-minute grace covers the normal capture-vs-stop race, but nothing longer. The desktop queue
classifies 422 as a **permanent client error** (`isTransientError()` — only 429/5xx/no-response
are retried), so the item's attempt counter advanced and the screenshot was **dropped**. Every
screenshot from an offline session older than five minutes was lost this way.

## Root cause 2 — the queue dropped fields on the way in that it read back on the way out

`OfflineQueue.add()` persisted only `file_path`, `time_entry_id`, `captured_at`, `app_name`,
`window_title`, while `flush()` read `data.idempotency_key`, `data.activity_score`,
`data.display_index`, `data.display_count`. Consequences:

- presign was sent `idempotency_key: undefined` → no dedupe, so a retried flush could create
  duplicate rows;
- multi-monitor shots lost their display identity;
- worst: a shot queued during an **offline start** carries a `local-…` entry id and is resolved
  via `_resolveEntryId()`; with no `idempotency_key` left, `_isUnresolvableOrphan()` could drop it
  outright.

## Root cause 3 — two different size caps

`ScreenshotService._queueForOffline()` refused anything `>= 1MB` while the queue itself stores up
to `MAX_SCREENSHOT_SIZE = 2MB`. Captures between 1–2 MB (routine on 4K / multi-monitor) were
silently discarded with a `console.warn` nobody sees.

## Fix

**Backend** — `presign()` accepts an offline backfill onto a closed entry when the capture
genuinely belongs to it:

- `LIVE_UPLOAD_GRACE_MINUTES = 5` (unchanged live behaviour);
- otherwise accept when `captured_at` falls inside
  `[started_at - 2min, ended_at + 2min]` (`BACKFILL_WINDOW_TOLERANCE_MINUTES`, absorbing clock
  skew) **and** the entry ended within `OFFLINE_BACKFILL_DAYS = 7`.

So a queue that flushes hours (or over a weekend) later lands its screenshots on the right entry,
while the endpoint still cannot attach arbitrary images to old history. `confirm()` needed no
change — it never had the active-entry check.

**Desktop**

- `OfflineQueue.add()` now persists every field `flush()` reads (`idempotency_key`,
  `activity_score`, `display_index`, `display_count`).
- `_queueForOffline()` uses `MAX_OFFLINE_SCREENSHOT_BYTES = 2MB`, documented as needing to stay in
  sync with the queue's own limit.

## Tests

- `backend/tests/Feature/Screenshot/ScreenshotTest.php` — backfill accepted for a closed entry;
  rejected when the capture is outside the entry window; rejected beyond the 7-day horizon.
- `desktop/test/offline-queue.test.js` — "add screenshot persists every field flush() reads back".
- `desktop/test/screenshot-service.test.js` — queues up to 2 MB, skips above it.

## Related

- [desktop-offline-heartbeat-orphan-queue-loop.md](desktop-offline-heartbeat-orphan-queue-loop.md)
- [desktop-offline-start-stop-lost-on-reconnect.md](desktop-offline-start-stop-lost-on-reconnect.md)
