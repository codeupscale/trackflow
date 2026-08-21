# Screenshots stopped uploading after the offline-first refactor

**Status:** fixed
**Found:** 2026-08-20 (production)
**Introduced:** 2026-08-13 — the offline-first time-sync rollout (desktop v1.0.46)
**Severity:** P1 — ~90% of screenshots permanently lost; monitoring evidence gone for most of the org

## Symptom

Time tracking synced correctly on the 10-minute cadence, but screenshots stopped appearing
on the dashboard. On 2026-08-20, 17 users tracked 5–8 hours each and only 3 had a single
screenshot between them. Each install stopped on its own date rather than all at once,
which made it look like an intermittent per-machine problem.

## Evidence

Screenshots arriving within 60s of capture (`created_at - captured_at`), production:

| Date | live | total |
|---|---|---|
| 2026-08-10 | 1613 | 1692 |
| 2026-08-11 | 1665 | 1677 |
| 2026-08-12 | 1627 | 1639 |
| **2026-08-13** | **47** | 292 |
| 2026-08-14 | 0 | 106 |
| 2026-08-18 | 0 | 835 |
| 2026-08-19 | 2 | 1025 |

The live path died on the exact day the offline-first refactor reached production.
Everything after it dribbles in through the offline queue: mean capture→arrival lag of
**15–42 hours**, with 833 shots in the last 7 days taking more than 24 hours.

Heartbeats were unaffected — all 17 users were sending them up to the current minute —
which is what ruled out connectivity, auth, sync, and the S3 pipeline, and isolated the
fault to the screenshot path.

## Root cause

`startTimer()` makes no network call any more, so `currentEntry.id` is the local SQLite
id `local-<ts>-<rand>`. That id was handed straight to the capture service:

```js
screenshotService.start(currentEntry.id);   // index.js — a `local-…` id
```

`POST /screenshots/presign` validates `'time_entry_id' => 'required|uuid'` and then
`firstOrFail()`s it against `time_entries`. `local-1755690000-ab3f` is not a uuid, so
**every live screenshot 422'd**, exhausted its 3 retries, and fell into the offline queue.

`rebindEntryId()` — the function written for exactly this — was only ever called by
`reconcileTimerState()`, which the refactor deleted. The one surviving call site (the
midnight split) passes another `local-…` id. So `currentEntryId` was never a real server
id for the entire life of the process. The rare live successes came from
`restoreLocalActiveSession()`, the only path using `server_entry_id || localActive.id`,
i.e. an app restart mid-session.

### Why the queued fallback then lost them for good

Queued screenshots resolve `local-…` → real id by reading `timer_sessions.server_entry_id`.
Two deletes remove that row with no knowledge of the queue's separate database:

- `purgeConfirmed()` — 24h after confirmation, on the 05:00 sweep
- `clearForLogout()` — every sign-out

With a backlog lag of 15–42 hours, shots routinely outlived their own session row. The
`idempotency_key` fallback could not save them: the queued key is the **screenshot's**
per-shot dedupe key, never the session's. Unresolvable items are then *held*, not dropped —
`continue; // do NOT count an attempt` — so they accumulated at the head of
`ORDER BY priority DESC, id ASC LIMIT 500` and were finally deleted, silently, with their
image files, by the 7-day TTL sweep. Heartbeats escaped all of this because they are
priority 1 and carry the session's uuid as their `idempotency_key`.

## Fix

1. **Rebind on confirm.** `SessionSyncWorker` gained `onSessionConfirmed(localId, serverEntryId)`,
   fired once per session on the transition from "server has never seen this" to "id known".
   `index.js` wires it to `screenshotService.rebindEntryId()`. This is the only signal that
   can un-break the live path, because capture is bound before any server id exists.
2. **Seed correctly.** `liveCaptureEntryId()` prefers an already-known server id, covering
   restore-after-restart, project switch, and any session older than one sync cycle.
3. **Anchor queued shots to the session.** `_queueForOffline()` records `session_uuid`
   (the session's identity) alongside the per-shot `idempotency_key`, `add()` persists it,
   and `_resolveEntryId()` resolves through it first.
4. **Purge guard.** `purgeConfirmed()` takes a keep-list; the worker feeds it
   `offlineQueue.referencedSessionKeys()` so a session is never deleted while a queued
   item still needs it.
5. **No silent loss.** A flush that holds screenshots now logs it, escalating to
   `console.error` past 50 — the failure mode above was completely silent.

## Regression tests

`desktop/test/screenshot-entry-id-binding.test.js` — 12 tests covering the rebind
callback (fires once, never re-fires, survives a throwing handler), the index.js wiring,
`session_uuid` persistence and resolution precedence, and the purge keep-list.

## Lessons

- **Deleting a caller can silently orphan the fix it existed for.** `rebindEntryId()`
  survived the refactor; the only thing that called it did not. Its comment still named
  `reconcileTimerState()` as the caller — a dangling reference in a comment is a signal
  worth grepping for whenever a subsystem is removed.
- **Two SQLite databases with a foreign-key relationship and no constraint between them
  will drift.** The purge was provably safe against everything in *its own* database.
- **"Held, not dropped" is not a safe default** when nothing bounds or reports the hold.
  It converted a loud, fixable 422 into silent deletion a week later.
- The blast radius came from a fallback path being promoted to the primary path. The
  offline queue was sized for occasional outages and was suddenly carrying 36 shots/hour
  per user, forever.
