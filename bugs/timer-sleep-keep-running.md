# Sleep/lid-close hard auto-stop removed — timer keeps running

**Status:** ✅ FIXED (2026-07-07)
**Severity:** P1 — product policy change per owner request
**Scope:** Desktop `power-manager.js`, `index.js`

## Symptom

Closing the laptop lid or locking the screen while the timer was running (and no idle popup open) **hard-stopped** the timer and showed a “Timer auto-stopped” notification. Owner wants elapsed time to **continue through sleep** instead.

## Previous behavior (2026-06-19 fix)

`timer-sleep-hard-auto-stop.md` — hard auto-stop on suspend prevented overnight inflation (timer showing 15h after sleep). That policy is reversed for the normal non-idle case.

## New behavior

| Case                               | On sleep/lock                                         | On wake                                    |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Timer running, **no** idle popup   | Pause screenshots + activity; **timer keeps running** | Resume capture; elapsed includes sleep gap |
| Timer running, **idle popup open** | Preserve popup (Bug B); timer stays server-paused     | Re-show popup with full idle duration      |
| Timer **not** running              | Tear down idle detector                               | —                                          |

Hard auto-stop on suspend is **opt-in only** (`shouldAutoStopOnSuspend: () => true`) for legacy/tests. Production registers `() => false`.

## Edge cases (unchanged)

- **App crash/kill during sleep:** startup gap detection (`detectAndCloseStaleSessionOnStartup`) may still close the open entry at `lastActiveAt` if the app restarts after a long gap.
- **Server stale cleanup:** no heartbeats during sleep; entries open >4h without server heartbeats may be closed by `timer:cleanup-stale`.

## Key files

- `desktop/src/main/power-manager.js`
- `desktop/src/main/index.js`
- `desktop/test/power-sleep-auto-stop.test.js`
- `desktop/test/idle-sleep-preservation.test.js`
