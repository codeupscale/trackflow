# Desktop elapsed inflated after idle reassign/discard (web correct)

**Status:** ✅ FIXED (2026-06-22, `develop`) — online reassign/discard path. Offline-while-
reassigning variant tracked as a follow-up below.

**Scope:** Desktop agent idle handling ↔ local-first anchor; web/backend are correct.

**Severity:** P1 — desktop timer over-counts after an idle split; misleads the user.

## Symptom (reproduced)

1. Start timer, work; first idle window → **Keep** → time correct.
2. Second idle window → disconnect from internet (web shows the timer **paused**).
3. Reconnect → click **Reassign**.
4. Desktop timer jumps to **~25 min** when it should be **~14 min**. **Web shows the correct
   ~14 min.** Only the desktop display is wrong.

## Evidence (dev DB, user `mirza.blade@yopmail.com`, 2026-06-22)

The server split the session correctly:

| Entry | Type | Window | Dur |
| ----- | ---- | ------ | --- |
| `019eeebc` | tracked | 09:49:51 → 09:58:24 | 8.6 min (pre-idle work) |
| `019eeeca` | idle | 09:58:24 → 10:03:24 | 5 min (marker) |
| `019eeeca` | tracked | 09:58:24 → 10:03:24 | 5 min (reassigned) |
| `019eeeca` | tracked | 10:03:24 → **open** | running |

Web shows the running entry's elapsed from **10:03:24** (≈14 min). The desktop was still
counting from the **original** start (~09:50) → ≈25 min.

## Root cause

The desktop's visible elapsed is `now − _cachedStartedAtMs`. On idle reassign/discard the
server ends the pre-idle entry, records the idle window, and opens a NEW entry at idle-end.
[`handleIdleAction()`](../desktop/src/main/index.js) correctly set the in-memory anchor
`_cachedStartedAtMs = new_entry.started_at`, **but never updated the local SQLite
`timer_sessions` row** — it still held the original pre-idle `started_at`.

The local row is the local-first source of truth. Any later re-derivation of the anchor from
`getActiveLocalTimer()` (the periodic `reconcileTimerState()`, phantom-stop recovery, or
`applyRunningStatusFromServer()`) re-reads that stale row and sets
`_cachedStartedAtMs = <original start>`. Then [`adoptServerStartedAt()`](../desktop/src/main/index.js)
refuses to move the anchor **forward** (the "BUG 2: never push start forward" guard:
`serverMs <= _cachedStartedAtMs`), so the correct idle-end start (10:03:24) is rejected and the
inflated value is locked in. The desktop thus counts through the idle (+ pre-idle) time that
the server correctly excluded.

This is why **Keep** was fine (no split → original start stays correct for both sides) but
**Reassign/Discard** broke (the session legitimately re-anchors to idle-end, and only the
server followed).

## Fix

In the reassign/discard success path of `handleIdleAction()`, re-anchor the **local session**
to the resumed entry: close the stale local row at idle-start (mark synced — the server already
split it) and open a fresh local `timer_sessions` row anchored at `new_entry.started_at`, bound
to the new server entry id. Now `getActiveLocalTimer()` returns the post-idle start everywhere,
so reconcile/recovery can no longer revert the anchor.

## Follow-up (separate, latent — NOT the reported repro)

Reassign/discard while **still offline** queues an `idle_discard`
([offline-queue.js](../desktop/src/main/offline-queue.js) `reportIdleTime`) and ignores the
returned `new_entry`; the local row is likewise never re-anchored, so the same inflation can
appear after the queue flushes. The reported bug is the online path (reconnected → then
reassigned), which is fixed. The offline variant should mirror this fix — re-anchor the local
session locally at idle-end on the offline-resume, or re-anchor on idle_discard flush.

## Verify

- `cd desktop && npm test` — full suite still green (466/466).
- Manual: timer running → force idle → Reassign → desktop elapsed matches the web running
  entry (counts from idle-end, not original start), and stays correct across a reconcile tick.

## Key files

- `desktop/src/main/index.js` — `handleIdleAction()` reassign/discard re-anchor;
  `adoptServerStartedAt()` (the never-move-forward guard this interacts with).
