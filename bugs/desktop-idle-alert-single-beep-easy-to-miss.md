# Idle alert only beeps once — easy to miss on a machine that never sleeps

**Status:** fixed
**Reported:** 2026-08-27 (owner, from employees)
**Severity:** P2 — delays the user noticing the idle popup, increasing exposure to the
idle hard-stop watchdog and untracked time

## Symptom

Employees reported "no notification" when the idle alert appeared on a machine that never
sleeps or locks (charger + external display — the same setup documented in
[desktop-no-notification-on-return-from-break.md](desktop-no-notification-on-return-from-break.md)).
The popup and its sound were both firing correctly, but the WebAudio beep
(`idle-alert.js`) only ever played **once**, at the instant the window first became
visible. Anyone not looking at the screen in that exact second — on a call, reading
something on a second monitor, momentarily away from the desk without having gone idle
long enough to be genuinely "away" — never heard it, and the OS system notification
(`showSystemNotification()`, the documented secondary path) is routinely dropped by
macOS Focus/DND, Windows Action Center, or Linux libnotify with no fallback of its own.

A single beep only reaches someone whose attention happens to line up with the exact
moment idle crosses the threshold. It does nothing for the more common case of a user
who drifts back into range over the following minutes.

## Fix

`idle-alert.js`'s beep now repeats every 5 seconds (`BEEP_REPEAT_MS`) for as long as the
popup is on screen, via an idempotent `startBeepLoop()` called from every `idle-data`
message (so it self-heals regardless of which message starts it) and stopped on
resolution (`sendAction`, the dismiss button, `beforeunload`) and on the (currently
unreachable, since interactive auto-stop is disabled by product decision — see
`idle-detector.js`) `auto-stopped` transition. Each tick checks
`document.visibilityState === "visible"` before sounding, so it stays silent while the
window is merely hidden-not-destroyed during the sleep-preservation path
(`hideIdleAlertWindows()` in `desktop-idle-window-multiscreen-and-sleep.md`) instead of
beeping into a locked screen; `reshowIdleAlertAfterResume()`'s `playSound:true` still
beeps immediately on resume and the loop keeps ticking from there.

The tone itself was also redesigned to be more distinctive — a four-note "boop boop
be-DOOP" (triangle wave, C5-C5-E5-B5 with a comedic upward jump on the last note) in
place of the old two-tone sine rise, so it's unmistakable and doesn't get confused with
the three-descending-tone return-to-work chime or any OS sound.

## Lessons

- A one-shot cue only reaches a user whose attention already lines up with the moment it
  fires. Anything meant to catch someone who is *not* currently looking needs to repeat
  until it's acknowledged, not just fire once and hope.
- Keep `startBeepLoop()` idempotent and callable from every code path that could
  plausibly be "the alert is now showing" — a stateful one-shot flag (the old
  `_hasBeeped`) is exactly the kind of thing that silently stops firing the moment a call
  site changes.

## Regression tests

No dedicated unit test — `idle-alert.js` runs in a `BrowserWindow` renderer context with
no `jsdom` harness in this repo (consistent with the rest of that file, which relies on
`desktop/test/e2e/idle-alert.test.js` for behavioral coverage instead). Verified manually
via the idle-alert e2e harness.
