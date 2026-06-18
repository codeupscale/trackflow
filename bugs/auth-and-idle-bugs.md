# Auth & Idle Bugs

**Status:** ✅ FIXED 2026-06-16 (on branch `chore/desktop-electron-42-upgrade`, uncommitted) — verified by tests, not yet committed.
**Investigated:** 2026-06-16
**Scope:** Desktop agent (Electron) — token persistence (auth) + idle-alert state machine
**Overall verdict:** Two unrelated implementation defects. Both are targeted repairs, not redesigns.
The token-encryption scheme and the idle state machine are architecturally sound; the bugs were a
volatile key-derivation input (BUG A) and a state-machine clobber from a spurious `start()` (BUG B).

## Resolution summary (2026-06-16)

- **BUG A (P1):** The AES-256-GCM token key was derived from the *set of all network-interface MAC
  addresses*, which is volatile across launches (VPN/`utun`, Docker bridges, USB/Bluetooth adapters
  appear/disappear). When the set changed, the derived key changed, `tokens.enc` no longer decrypted,
  and the user was forced to log in on every restart. Fixed by deriving the key from a **persisted
  random 32-byte device secret** (`.device-key` in `userData`) + the userData-path salt. Stable across
  launches, machine/install-bound, no OS keychain, identical on all platforms.
- **BUG B:** The idle prompt "sometimes didn't appear" and "disappeared by itself." The disappear is
  the by-design safety auto-stop (kept, with notification feedback — confirmed correct). The
  intermittent *non-appearance* was a real race: a spurious `IdleDetector.start()` (from the timer
  sync loop on a transient `status.running && !isTimerRunning` tick, or reconcile) reset
  `idleStartedAt`/`alertShownAt` to `null` and cleared the auto-stop interval **while an alert was
  DETECTED/ALERTING**. With `showIdleAlert()` mid-`await loadProjects()`, `isIdleActive()` flipped to
  `false` and the show guard swallowed the popup. Fixed by making `start()` a no-op while DETECTED or
  ALERTING, preserving the live cycle.

**Tests:** desktop 410 → 416 (+6). No new failures (21 pre-existing failures unchanged: `screenshot-service`,
`idle-detector` cooldown test, `idle-alert-reappear`/`idle-alert-window` cooldown tests).
Cross-platform safe (no `process.platform` branches touched in either changed file).
Files: `desktop/src/main/keychain.js`, `desktop/src/main/idle-detector.js`.
New/changed tests: `desktop/test/keychain.test.js` (+3), `desktop/test/idle-detector.test.js` (+3).

---

## BUG A — User must re-login every time the app is quit & reopened

**Symptom:** Every time the app is fully quit and reopened, the user is sent back to the login screen,
even though they never logged out and the token had not expired.

**Root cause (P1):** `desktop/src/main/keychain.js` `deriveKey()` built the AES-256-GCM key from the
**set of all non-zero network-interface MAC addresses** (`os.networkInterfaces()`):

```js
// OLD (buggy)
const macs = [...all interface MACs...].sort();
const macHash = sha256(macs.join(':'));
machineId = `trackflow-${macHash}-v2`;
return crypto.pbkdf2Sync(machineId, userDataPath, 100000, 32, 'sha256');
```

That MAC set is **volatile across launches** on real machines:
- iCloud Private Relay / VPN add and remove `utun*` interfaces (each with its own MAC).
- Docker / virtualization add/remove bridge interfaces.
- USB Ethernet dongles and Bluetooth PAN adapters connect/disconnect.

When the set changed, `machineId` changed, so `deriveKey()` produced a **different key**. The on-disk
`tokens.enc` (written under the old key) then failed GCM auth on decrypt. `readTokensFromDisk()`
catches the failure and returns "no token" → the app treats the user as logged out.

**Verified NOT the cause:** Normal quit does not delete the token — the `before-quit` handler
(`index.js:705`) stops the timer but never wipes `tokens.enc`; `deleteToken()` is only called on
explicit logout. The instability was entirely in the key input.

**Evidence:** old `deriveKey` derived from MAC set (pre-fix `keychain.js:29-53`); decrypt failure is
swallowed and treated as "no token" at `desktop/src/main/keychain.js:136-138`.

**Fix:** Derive the key from a **persisted, machine-bound random secret** instead of volatile hardware
enumeration. `desktop/src/main/keychain.js`:

- `loadOrCreateDeviceSecret()` (`keychain.js:52-83`): on first run, generate a 32-byte secret with
  `crypto.randomBytes(32)` and persist it to `.device-key` in `app.getPath('userData')`
  (mode `0o600` on POSIX, no-op on Windows). On every later run, read it back. If the file is missing
  or truncated, regenerate. If persistence fails entirely, fall back to a process-lifetime secret so
  the app **never crashes** (no secret is logged).
- `deriveKey()` (`keychain.js:85-89`): `pbkdf2Sync(deviceSecret, userDataPath, 100000, 32, 'sha256')`.
  Still AES-256-GCM, tokens still in `userData`, never in SQLite.

**Why the key is now stable:** the only inputs are (1) a random secret written once to disk and never
changed, and (2) the userData path (constant per install). Neither varies with network state, VPNs,
Docker, or peripherals — so the same key is derived on every launch and `tokens.enc` always decrypts.

**One-time migration / graceful fallback:** Existing users' `tokens.enc` was encrypted under the old
volatile key and will not decrypt under the new device-key. That failed decrypt is handled gracefully
by the existing `try/catch` in `readTokensFromDisk()` (treated as "no token" → login). Users re-auth
**once**; from then on the key is stable forever. `deleteToken()` (logout) wipes only `tokens.enc` and
preserves `.device-key`, so the next login is immediately decryptable.

**Cross-platform safety:** Pure `fs` + `crypto` + `app.getPath` — identical on Windows / macOS / Linux.
No native module, no OS keychain (so **no macOS keychain popup**, per CLAUDE.md). The `0o600` mode and
`chmodSync` are POSIX-only and harmlessly ignored on Windows (the file lives in the per-user profile).

---

## BUG B — Idle popup is intermittent and "disappears by itself"

**Symptoms:**
1. The idle prompt **sometimes does not appear** when the user is genuinely idle past the threshold.
2. The idle prompt **disappears on its own** after a while.

### Part 2 first — "disappears by itself" is BY DESIGN (confirmed correct, kept)

`idle-detector.js` `_checkAutoStop()` (`idle-detector.js:347-374`) fires `onAutoStop` after the alert
has been shown for `alertAutoStopSec` (`idle_alert_auto_stop_min`, default 10 min). The `onAutoStop`
callback (`index.js:976-990`) stops the timer and **already shows a system notification**
("Timer was automatically stopped after N minutes of inactivity"). The auto-stop discards the idle
interval before stopping (`handleIdleAction('stop', …)` → `reportIdleTime({action:'discard'})` then
`stopTimer()`, `index.js:3048-3077`), so no idle minutes are banked — the timer effectively stops at
idle-start. **Math verified:** `_checkAutoStop` compares `(now - alertShownAt)` against
`alertAutoStopSec`, where `alertShownAt` is set at detection (`_check`, `idle-detector.js:304`) /
`setAlertState` (`idle-detector.js:169`) — so the popup is genuinely shown for the full window before
auto-stop. The prior long-sleep "fires immediately" bug (comparing total idle vs threshold) was already
fixed (see comment block `idle-detector.js:323-335`) and its regression test passes. **Decision:** keep
the safety auto-stop; the user already receives clear notification feedback. Not removed.

### Part 1 — "sometimes doesn't appear" is a REAL race (fixed)

**Root cause:** A spurious `IdleDetector.start()` could clobber a live idle cycle.

The timer sync loop, on a transient tick where the server reports `status.running` while the local
`isTimerRunning` flag was momentarily `false`, runs the "adopt running timer" branch and calls
`idleDetector.start()` (`index.js:2625`). Reconcile / new-entry handling can also call
`idleDetector.stop()` + `start()` (`index.js:2086-2087`). The old `start()` (`idle-detector.js:84-108`)
allowed entry from **any** state (pre-fix lines) — when called during `DETECTED` or `ALERTING` it would
`_clearInterval()` (killing the auto-stop interval) and reset:

```js
this._state = IDLE_STATE.WATCHING;
this.idleStartedAt = null;   // ← live alert state destroyed
this.alertShownAt = null;
```

`showIdleAlert()` is `async` and `await loadProjects()` (`index.js:2809`) **before** creating the
BrowserWindow. If the spurious `start()` landed during that await, `idleDetector.isIdleActive()` flipped
to `false`, and the guard `if (!idleDetector?.isIdleActive()) return;` (`index.js:2791`) then aborted
the show — the popup silently never appeared, even though the user was idle.

**Fix:** `idle-detector.js` `start()` (guard at `idle-detector.js:88-98`) now treats a call during an
active idle state as a no-op, preserving the live cycle:

```js
if (previousState === IDLE_STATE.DETECTED || previousState === IDLE_STATE.ALERTING) {
  console.warn(`[IdleDetector] start() called in active state ${previousState} — ignoring to preserve live alert`);
  return;
}
```

The legitimate re-arm paths are unaffected: `start()` from `STOPPED` (new timer session) and from
`RESOLVED` (after `resolveIdle`/auto-stop) still work exactly as before. The current alert cycle now
always resolves through `resolveIdle()` / auto-stop, which transitions to `RESOLVED` and re-arms
cleanly afterward.

**Why this is the right layer:** the idle detector is the authoritative owner of idle state (the
existing `index.js:2788-2791` comment already established that intent). Guarding at the state machine
fixes every spurious-`start()` source at once (sync loop, reconcile, new-entry restart) rather than
patching each call site.

**Did-finish-load fallback verified:** `showIdleAlert` registers both `ready-to-show` and
`did-finish-load` → `showAndSendData()` with a `shown` guard (`index.js:2842-2865`). Both call the same
idempotent shower, so the window reliably shows once the load completes; that path was not the cause and
is left intact.

**Cross-platform safety:** The fix is in `idle-detector.js`, which has **no** `process.platform`
branches — idle detection uses `powerMonitor.getSystemIdleTime()` uniformly on Win/Mac/Linux. The
`visibleOnAllWorkspaces` window option (macOS Spaces / Linux workspaces) in `showIdleAlert` is unchanged.
Behavior is identical on all three platforms.

---

## Tests

**BUG A — `desktop/test/keychain.test.js` (+3):**
- `.device-key` file is created and persisted on first token write (32-byte secret).
- Tokens decrypt across a **fresh module load** (simulated app restart) when the device key persists —
  the exact scenario the volatile-MAC key broke.
- `deleteToken()` (logout) removes `tokens.enc` but **preserves** `.device-key`.

**BUG B — `desktop/test/idle-detector.test.js` (+3):**
- `start()` during `ALERTING` is a no-op and preserves `idleStartedAt`/`alertShownAt`/actionId/state.
- `start()` during `DETECTED` (callback mid-flight) is a no-op; `_check()` still promotes to `ALERTING`.
- Auto-stop still fires after a spurious `start()` during `ALERTING` (interval not cancelled).

**Suite:** `npm test` 410 → 416 passing. 21 pre-existing failures unchanged (no new failures).
