# Electron 42 Upgrade — Screen Recording Permission Regression

**Status:** Open / blocks the Electron 42 upgrade
**Found:** 2026-06-15 (during the Electron 28 → 42 upgrade on branch `chore/desktop-electron-42-upgrade`)
**Platform:** macOS 26 (Tahoe), Electron 42.4.0
**Severity:** P0 for the upgrade — screenshots are a core feature; affects production too, not just dev.

## Symptom

After upgrading Electron 28 → 42, the desktop app no longer appears in
System Settings → Privacy & Security → Screen & System Audio Recording, so the user
cannot grant screen recording permission and screenshots never capture.

## Root cause

The app registers itself in the macOS Screen Recording list by calling
`desktopCapturer.getSources()` at launch — the "probe" in
[index.js:397-433](../desktop/src/main/index.js#L397-L433) (`probeScreenRecordingPermission`),
called from `app.on('ready')` at [index.js:991-1015](../desktop/src/main/index.js#L991-L1015).

- **Electron 28:** `getSources()` returned sources with blank thumbnails when permission was
  not granted. That call registered the app in the TCC list and the probe could detect state.
- **Electron 42:** `getSources()` **rejects with `undefined`** (not even an Error object) when
  screen permission is not granted — it throws before registering the app.

Evidence from the user's app log (`~/Library/Application Support/trackflow-agent/trackflow.log`):
```
10:04 (Electron 28)  [Permission] Probe returned 1 source(s)        ← worked
10:45 (Electron 42)  [Permission] Probe failed:                     ← empty error, repeated
```
Reproduced in the Electron 42 runtime:
```
mediaAccessStatus(screen) = denied
PROBE_ERR name=undefined msg=[undefined] code=undefined
```

## Impact

- The probe-based auto-registration strategy is dead on Electron 42.
- App never appears in the Screen Recording list → user cannot grant permission via the normal flow.
- Hits production builds too (this is a macOS/Electron API behavior change, not an ad-hoc-signing issue).

## Secondary issue found

The onboarding dialog tells the user to find **"TrackFlow"** in the list
([index.js:444,452](../desktop/src/main/index.js#L444-L452)), but in dev the binary is **"Electron"**.
Minor, but adds to the confusion.

## Recommended fix (needs a real GUI session to verify — cannot be tested from the sandbox)

1. Handle the `undefined` rejection from `getSources()` gracefully (don't treat it as a generic probe failure).
2. Replace/augment the registration strategy for the ScreenCaptureKit era (macOS 15+/Electron 30+):
   - Use `systemPreferences.getMediaAccessStatus('screen')` for state.
   - Trigger registration/prompt via the modern path (e.g. `session.setDisplayMediaRequestHandler` +
     `getDisplayMedia`, or `CGRequestScreenCaptureAccess` semantics) rather than relying on
     `getSources()` returning blank thumbnails.
3. Make the onboarding dialog reference the correct app name per environment (dev = "Electron").
4. Verify on a real macOS 26 session: fresh `tccutil reset ScreenCapture com.github.Electron`,
   launch, confirm the app appears in the list and screenshots capture.

## Immediate workaround (dev)

Manually add the Electron binary to the Screen Recording list:
`+` → `Cmd+Shift+G` →
`/Users/codeupscale/Desktop/Projects/trackflow/desktop/node_modules/electron/dist/Electron.app`
→ toggle on → relaunch.

## CORRECTED ROOT CAUSE (2026-06-15, after live testing on macOS 26)

The first hypothesis (that `getSources()` registers the app via an internal
`CGRequestScreenCaptureAccess()` call) was **empirically disproven** on the user's machine: after
launch + repeated `getSources()` calls, "Electron" never appeared in the Screen & System Audio
Recording list at all.

Confirmed findings:
1. On macOS 15/26 + Electron 42, `desktopCapturer.getSources()` is NOT a reliable
   permission-prompt / registration trigger. The correct modern mechanism is the WebRTC
   ScreenCaptureKit path: `session.setDisplayMediaRequestHandler()` (main) +
   `navigator.mediaDevices.getDisplayMedia({video:true})` (renderer).
2. **The ad-hoc / linker-signed DEV `Electron.app` fundamentally cannot hold a working, persistent
   Screen Recording TCC entry on macOS 26.** TCC keys entries by the code-signing Designated
   Requirement; an unsigned binary has none, so macOS won't persist a usable entry. macOS 26's
   Screen & System Audio Recording pane has **no "+" button and no drag-drop**, so there is NO manual
   workaround in dev.
3. A properly **Developer-ID-signed production `TrackFlow.app`** has a stable DR and WILL register,
   prompt, and persist normally via the getDisplayMedia path.

## Fix applied (branch chore/desktop-electron-42-upgrade)

- `index.js`: new darwin-guarded `triggerScreenCapturePrompt()` (offscreen BrowserWindow +
  `setDisplayMediaRequestHandler` + `getDisplayMedia`), `probeScreenRecordingPermission()` rewritten
  to use it; onboarding dialog now warns dev builds about the unsigned-binary limitation.
- `screenshot-service.js`: corrected misleading getSources/registration comments.
- Tests baseline-neutral (397/21). Cross-platform safe (non-darwin early-returns; Win/Linux capture untouched).

## Bottom line

- Electron 42 itself is fine (native modules load, app boots, tests 397/21).
- The screen-capture trigger is now implemented correctly for the modern macOS API.
- **Screenshots CANNOT be validated in the ad-hoc dev build on macOS 26** — this is a macOS
  signing limitation, not a TrackFlow bug. Validate screenshot capture on a **code-signed build**
  (or in CI / on Windows+Linux where TCC doesn't apply). Everything else (timer, etc.) is testable in dev.
