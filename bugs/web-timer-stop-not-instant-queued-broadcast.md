# Web dashboard not stopping instantly when desktop stops the timer

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Backend broadcast events + web dashboard realtime listener.

**Severity:** P2 — correctness OK (stops within the 10s poll), but the real-time stop felt laggy.

## Symptom

Click **Stop** on the desktop; the web dashboard keeps counting for a few seconds before it
stops, instead of stopping immediately.

## Root cause

`TimerStarted` / `TimerStopped` implemented `ShouldBroadcast` (**queued**). With
`BROADCAST_CONNECTION=reverb`, the broadcast is pushed onto the queue and processed by Horizon
before it reaches Reverb → the web's `TimerStopped` listener fires late (or after the next 10s
`/timer/status` poll, which is the real fallback). So the stop wasn't real-time.

## Fix

1. **Backend** — `TimerStarted` and `TimerStopped` now implement `ShouldBroadcastNow`
   ([app/Events/](../backend/app/Events/)), so the event publishes to Reverb **synchronously**
   during the start/stop request (~100ms to the browser) instead of going through the queue.
   (Test env uses `BROADCAST_CONNECTION=null`, so this is a no-op in tests — no breakage.)
2. **Web** — the `TimerStopped` listener now freezes the counter **instantly** when the stop is
   for the entry currently being displayed (`e.entry_id === entryId` → `stopTicking()` +
   `isRunning=false`), then calls `fetchStatus()` to reconcile totals. Removes the extra
   round-trip wait. Org-scoped events for *other* users still just trigger a (cheap) re-fetch.

## Verify

- Backend: `php artisan test --filter=Timer` — only the 5 unrelated pre-existing failures; this
  change adds none (null broadcast driver in tests).
- Web: `npx vitest run src/stores/timer-store.test.ts` — 18/18.
- Manual: desktop Stop → web stops within ~100–200ms (Reverb event), no longer waiting for the
  10s poll.

## Note

This needs **both** a backend deploy and a web deploy. Real-time delivery still depends on Reverb
being up and the web's Echo connection being authenticated; when those are unavailable the 10s
status poll remains the (correct) fallback.

## Key files

- `backend/app/Events/TimerStopped.php`, `backend/app/Events/TimerStarted.php`
- `web/src/stores/timer-store.ts` (`setupWebSocket` TimerStopped listener)
