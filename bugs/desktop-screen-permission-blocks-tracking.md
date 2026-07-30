# Screen Recording permission blocked time tracking, and its banner could never clear

**Status:** ✅ FIXED (2026-07-30)
**Severity:** P0 — the user could not track any time on macOS. Start either opened a modal or
returned an error; it never started the timer.
**Scope:** `desktop/src/main/index.js` (`startTimer` pre-start gate,
`checkScreenRecordingPermission`, `probeScreenRecordingPermission`,
`showScreenPermissionOnboarding`, new `refreshScreenPermissionOnFocus`),
`desktop/src/renderer/index-renderer.js` (permission banner).

## Symptom (owner, 2026-07-30)

> "and im still not able to track my time"
> "the yellow label still staying"
> "in the new redesign app, the permission is not disappearing after giving permission from mac,
> even start button open the same permission wrapper"

The app's own log captured the loop exactly:

```
14:19:13  [Timer] Screen recording permission not granted — showing onboarding
14:19:21  [RestartState] Saved            ← user clicked "Open System Settings"
14:19:35  [Timer] Screen recording permission not granted — showing onboarding   ← same modal
```

No `time_entries` row was ever created, because the handler returned before opening a session.

## Root cause

Four independent defects compounded into a closed loop with no exit.

### 1. The permission gate blocked TIME, not just screenshots

`startTimer()` treated a missing Screen Recording grant as fatal:

```js
if (permResult === "opened-settings") {
    return { error: "Please grant Screen Recording permission and restart the app. …" };
}
```

Choosing "Open System Settings" — the button the dialog defaults to — aborted the start. Screen
Recording gates *evidence capture*; it must never cost tracked hours.

### 2. The "ask once per session" flag was set on the wrong button

`_screenPermissionSkippedThisSession` was set only in the "Skip for Now" branch. A user who picked
"Open System Settings" left it false, so the identical modal re-opened on **every** subsequent
Start.

### 3. Nothing ever re-checked the permission

The amber banner was cleared by exactly two things: a *successful screenshot* — impossible while
the permission is missing — and a one-shot `checkPermission()` at renderer load. There was no
re-check on focus, on an interval, or on returning from System Settings. Once raised, the banner
was permanent for the life of the process.

### 4. macOS caches a process's TCC verdict for its lifetime

This is the part that made the whole thing look insane. Verified against the system TCC database
while the app insisted permission was missing:

```
kTCCServiceScreenCapture | com.trackflow.agent | auth_value=2   ← ALLOWED
```

and the stored code requirement matched the installed binary exactly:

```
stored:  cdhash H"de309be1ed961880559fb572b837308ba108e0e2"
app:     CDHash=de309be1ed961880559fb572b837308ba108e0e2
```

macOS had recorded the grant, and it was valid. But a grant made **while the app is running** is
invisible to that process — which is why macOS itself offers "Quit & Reopen". The app never noticed
and never offered the restart, so the user granted the permission, came back, and saw the same
refusal forever.

Confirmed with timestamps in a later session: the grant landed at `14:49:43`; at `14:49:48` — five
seconds later, same process — the probe still failed and `getMediaAccessStatus()` still said
`denied`.

### Diagnostic note: the probe error was empty

A TCC denial rejects `desktopCapturer.getSources()` with an error carrying **no** `name`, `message`
or `code`. A standalone Electron probe confirmed it:

```
thumbnailSize 1x1:     REJECTED name=undefined msg="undefined" code=undefined
thumbnailSize 64x64:   REJECTED name=undefined msg="undefined" code=undefined
```

So the pre-existing `console.warn("[Permission] Probe failed:", e.message)` logged
`"Probe failed: "` and nothing else. Logging the whole error yields `Failed to get sources.`, which
is at least actionable. That change is kept.

## Fix

- **Tracking is never gated on screenshots.** The prompt still appears, at most once per session,
  and the timer starts regardless of how it is answered. `_screenPermissionSkippedThisSession` is
  set for *both* buttons.
- **`refreshScreenPermissionOnFocus()`**, hung off `browser-window-focus` — returning from System
  Settings *is* a focus event. It runs a free `getMediaAccessStatus()` check every time (no dialog,
  and for a properly signed build this alone flips), and spends a rate-limited `desktopCapturer`
  probe only when the user has actually been sent to Settings. Probing on every focus would raise
  the native macOS prompt repeatedly.
- **A relaunch offer** when the probe still fails after that trip — the only thing that clears the
  cached TCC verdict. Deliberately **not** once-per-session: see the regression below.
- **Every branch logs its decision.** A silent re-check is undebuggable from a user's log, which is
  how defect 3 survived this long.
- **Dialogs name the exact path and the correct row**, chosen by `app.isPackaged`. A dev run is
  listed by macOS as **"Electron"**, so telling that user to look for "TrackFlow" sent them hunting
  for a row that does not exist. Path is now spelled out:
  `System Settings ▸ Privacy & Security ▸ Screen & System Audio Recording`.

### Regression introduced and fixed within the same session

The first version of the relaunch offer used a once-per-session boolean. Observed in a real
session: the user tabbed back from System Settings **before** granting, was offered the restart,
declined it (correctly — they had granted nothing yet), and the flag then suppressed the offer
permanently. Seconds later the grant landed and the app had no way left to say a restart was
needed — reproducing the exact dead end this change exists to remove. It is now on a 45s cooldown
and re-arms every time the user is sent to System Settings.

## Also fixed: an empty project dropdown blocked Start independently

`DatabaseSeeder` created three projects but only ever attached members to **teams**, leaving
`project_user` empty. An employee signing in to the desktop agent got an empty project dropdown,
which disables Start outright (`updateStartBtnState()`), so a freshly seeded database could not
track any time at all. The seeder now assigns members to projects.

## Testing-method traps worth recording

Two things wasted hours during diagnosis and will do so again:

1. **`npm run dev` can never capture screenshots on macOS** when launched from a terminal. macOS
   attributes a capture request to the *responsible process*, which for anything spawned from a
   shell is the terminal — here `com.apple.Terminal auth=0`, explicitly denied. Electron's own
   grant is irrelevant. Launching via `open -a …` (launchd as parent, so the app is its own
   responsible process) resolves it immediately.
2. **`open -a Electron.app --args <path>` puts "Electron" in the Dock**, and clicking that Dock icon
   relaunches Electron with **no arguments** — loading its built-in demo window, not TrackFlow. This
   looks exactly like "the app stopped asking for permission" while in fact the app's code never
   ran. Test permission behaviour against a packaged build.

## Open follow-up: ad-hoc signing revokes the grant on every update

`package.json` → `build.mac.identity` is `null` (ad-hoc signed, not notarized). TCC pins Screen
Recording to the exact `cdhash`, so **every desktop update silently revokes Screen Recording for
every macOS user** — System Settings keeps showing TrackFlow toggled ON while capture fails, which
is indistinguishable from this bug. Reproduced while rebuilding during this session:

```
stored requirement:  cdhash H"29617bb567fa07a76dca39bf4c727ec345c5b103"   ← old build
new build cdhash:    43b54ba23acf6daf9ddf376b5785c17ab362a9b6
```

A Developer ID signature pins to the identity instead, and grants survive updates. Until then, the
remedy after any rebuild is `tccutil reset ScreenCapture com.trackflow.agent` (or removing and
re-adding the row) — a plain toggle-off/on does not always suffice. This is a likely source of
recurring "screenshots stopped working after an update" reports and is **not** addressed by this
fix.
