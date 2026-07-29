# Feature — "Always know your tracking state" notifications

**Status:** ✅ IMPLEMENTED (2026-07-23)
**Type:** Feature / trust & transparency
**Scope:** Desktop `index.js`, `system-notifications.js`

## Goal

The user must never be surprised that tracking stopped (or is still running). Fire a
single, clear system notification of the CURRENT tracking state on the transitions
where surprise is possible.

## Transitions covered

1. **Wake from sleep / lid-open** — `powerMonitor` `resume` (routed through
   `onResumeAfterSleep`).
2. **Screen unlock** — `powerMonitor` `unlock-screen` (also routed through
   `onResumeAfterSleep`).
3. **Login / startup auto-resume** — end of `initializeApp()` (covers both a fresh
   login and app startup that adopts a server-open session), plus the local
   restart-state auto-resume success branch.
4. **Automatic timer stop** — the existing reason-specific toast in
   `autoStopTimerForPowerEvent` (sleep-gap, idle-watchdog, lock/sleep) and the
   startup/stale-gap + idle-auto-stop toasts. Every automatic-stop route now stamps
   `markAutoStopNotified()` so those routes are the single source of the stop
   message.

## Content

- **Tracking active** → title `TrackFlow — Tracking active`, body
  `Timer is running · today Xh Ym. You're being tracked.` (today total = live
  all-projects total: server total + current session elapsed).
- **Not tracking** → title `TrackFlow — Not tracking`, body
  `Timer is stopped — you are NOT being tracked. Start the timer when you're ready.`
- **Automatic stop** → unchanged reason-specific wording ("…because no activity was
  detected / your computer went to sleep / was locked", with the stop time).

Clicking any state notification focuses the app (`onClick → showPopup()`,
cross-platform via Electron's `Notification` click event).

## Cross-platform

All notifications go through the existing `system-notifications.js`
(`showSystemNotification`, branded icon, Windows AppUserModelID, unique toast ids)
and `PowerManager.showAutoStopNotification`, so they work on macOS, Windows, and
Linux identically. No platform-specific branches added.

## How paired events are de-duplicated

A single lid-close→open emits PAIRED events: `suspend`+`lock-screen` on the way
down, `resume`+`unlock-screen` on the way up. Both `resume` and `unlock-screen` are
wired to the same `onResumeAfterSleep`, so a naive notif would fire twice.

The decision is the pure `shouldNotifyTrackingState()` (in `system-notifications.js`,
unit-tested). Guards, in order:

- **`isAuthenticated` false → never** (respects logout / no session;
  `removeSessionListeners()` also resets the dedup state so the next login always
  re-notifies).
- **`now - lastAutoStopNotifAt < autoStopSuppressMs` (8s) → skip** — an automatic
  stop just fired its specific toast; the generic notif suppresses itself so a
  resume-that-auto-stopped shows ONLY the "…no activity was detected" message, never
  a contradictory second one. (`autoStopAfterSleepGap` is awaited before the state
  notif in `onResumeAfterSleep`, so the stamp is always set in time.)
- **`isIdleAlertActive()` → skip** — a preserved idle alert being re-shown across
  sleep IS the state message; a state notif would contradict it.
- **Same tracking state within `debounceMs` (5s) → skip** — coalesces the paired
  `resume`+`unlock-screen` (identical state a tick apart) into ONE notification. A
  GENUINE state change (not-tracking → tracking) is always allowed through, so the
  startup "Not tracking" → auto-resume "Tracking active" sequence still surfaces.

It does NOT fire on the 10s sync loop — only on the four transitions.

## Key files / functions

- `desktop/src/main/system-notifications.js` — `buildTrackingStateNotification()`
  (pure content), `formatDurationShort()` ("Xh Ym"), `shouldNotifyTrackingState()`
  (pure dedup decision). All exported + unit-tested.
- `desktop/src/main/index.js` — `notifyTrackingState(reason)` +
  `liveTodayTotalSeconds()` + `markAutoStopNotified()`; dedup state
  (`_lastStateNotifAt` / `_lastNotifiedTracking` / `_lastAutoStopNotifAt`, reset in
  `removeSessionListeners()`); call sites: end of `initializeApp`, restart-state
  auto-resume success, tail of `onResumeAfterSleep`; `markAutoStopNotified()` at the
  three auto-stop toast sites (`autoStopTimerForPowerEvent`,
  `detectAndCloseStaleSessionOnStartup`, idle `onAutoStop`).
- `desktop/test/tracking-state-notification.test.js`,
  `desktop/test/system-notifications.test.js`.

## Environment note

Runtime is Electron 42.x. `Notification`, `powerMonitor` `resume`/`unlock-screen`,
and `Notification` `click` are all stable in Electron 42.

## Residual notes

- On every launch/login while not tracking, a "Not tracking" nudge fires — this is
  intentional (the feature's onboarding nudge), not spam; it never repeats within
  the 5s window and never fires on sync.
- If two automatic stops happen >8s apart around a wake, only the specific toasts
  fire (correct); the generic state notif stays suppressed during each 8s window.
