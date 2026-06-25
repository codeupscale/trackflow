# Offline reassign: live total keeps counting the idle on the origin project (UX)

**Status:** ✅ FIXED (2026-06-25, `develop`) — desktop display-only; data was already correct.

**Scope:** Desktop running-total display (tick / tray / get-timer-state) during an OFFLINE reassign.

**Severity:** P2 — misleading live display; the recorded data is always correct.

## Symptom

Reassign idle to another project while offline → the desktop keeps showing (and increasing) the
idle time on the **origin** project until the internet returns, at which point it splits to the
correct projects. The stored entries are correct; only the offline live number is wrong.

## Root cause

On an offline reassign the local timer is intentionally **not** re-anchored — re-anchoring
offline breaks the reconnect split (the server entry still spans the original window, so reconcile
reverts the displayed start, and a locally-closed entry makes the queued reassign no-op). So the
live elapsed (`now − _cachedStartedAtMs`) is measured from the original start and therefore
includes the reassigned idle on the origin project until reconnect re-attributes it.

## Fix (display-only, touches no entry/session/reconcile state)

Added `_pendingOfflineReassignIdleSec`, set to the reassigned idle duration when a reassign is
**queued offline**. The three running-total display points subtract it:
`todayTotalCurrentProject + max(0, sessionElapsed − _pendingOfflineReassignIdleSec)` — the tick,
the tray, and `get-timer-state`'s offline fallback. Because the live elapsed is anchored at the
original start, it already contains pre-idle + idle + post-idle, so subtracting the idle yields the
correct origin total (pre-idle + post-idle) **without** moving the anchor or touching sessions.

Cleared when the reassign syncs (`reanchorFromOfflineIdle`, which moves the anchor to idle-end and
makes the subtraction unnecessary), and on `stopTimer`/`startTimer`. The queued reassign and the
reconnect split are unchanged — the data path that was already correct is untouched.

## Known scope limit

This covers the **running** display. If the user stops while still offline, the stopped total can
briefly include the idle until reconnect re-splits it (data still correct). Tracked as a follow-up
if needed.

## Verify

- `cd desktop && npm test` — full suite green (508). New invariants in
  `timer-sync-invariants.test.js`: offline display subtracts the pending idle; without it the
  origin shows the full elapsed; clears to normal after sync; never negative.
- Manual: reassign offline → the origin project's live total excludes the idle immediately;
  reconnect → entries split correctly (unchanged), totals continuous.

## Key files

- `desktop/src/main/index.js` — `_pendingOfflineReassignIdleSec` (set in offline reassign catch;
  subtracted in the tick, tray `updateTrayMenu`, and `get-timer-state`; cleared in
  `reanchorFromOfflineIdle`/`stopTimer`/`startTimer`).
- `desktop/test/timer-sync-invariants.test.js`
