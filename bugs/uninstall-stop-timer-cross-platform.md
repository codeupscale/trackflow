# Timer keeps running after the app is uninstalled

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Desktop agent (Windows / macOS / Linux) + relies on the backend reclaim

**Severity:** P0 — uninstalling the agent left the server timer open, counting forever.

## Symptom

Uninstalling (or force-killing) the desktop app does **not** stop the running timer. The
open time entry keeps counting `started_at → now()` on the web dashboard, and — before the
auth fix — also blocked the next desktop login.

## Why a 100% client-side guarantee is impossible

There is **no uninstall hook on every OS**:

| Target | Pre-uninstall hook? | Notes |
| ------ | ------------------- | ----- |
| Windows NSIS | ✅ `customUnInit` macro | But it **force-killed** (`taskkill /F`), so `before-quit` never ran. |
| Linux `.deb` | ✅ `prerm` (root context) | Runs as root; can't reach the user's encrypted token reliably. |
| Linux AppImage | ❌ | "Uninstall" = delete the file. No code runs. |
| macOS `.dmg`/`.zip` | ❌ | "Uninstall" = drag `.app` to Trash. No code runs. |

So the OS may delete the app with **zero** app code executing. A client mechanism can only
cover the case where **the app is running** during removal. The true guarantee is server-side.

## Fix — three layers

1. **Runtime self-removal watcher (all OSes, when running).**
   `startSelfRemovalWatcher()` polls the install path every few seconds
   (`process.env.APPIMAGE || app.getPath('exe')`). If the app's own binary/bundle disappears
   while running (uninstall in progress) and we are not already quitting/updating, it calls
   `app.quit()` — which runs the existing `before-quit` graceful stop (local SQLite stop +
   best-effort server stop, 3s hard cap). Suppressed during auto-update (`isQuitting`) so an
   update file-swap never looks like an uninstall.

2. **Windows NSIS — graceful stop before force-kill.**
   [`build/installer.nsh`](../desktop/build/installer.nsh) `customUnInit` now launches
   `TrackFlow.exe --uninstall-stop` first, waits, then force-kills as a fallback. The flag is
   forwarded by the single-instance lock to the **running** app via `second-instance`, which
   calls `app.quit()` → graceful stop. (A fresh `--uninstall-stop` process that acquires the
   lock — i.e. app wasn't running — just exits; nothing in memory to stop.)

3. **Backend reclaim + scheduled cleanup (the real guarantee).**
   See [single-desktop-session.md](single-desktop-session.md): the next desktop login closes
   any orphaned timer at its last heartbeat, and `timer:cleanup-stale` (30 min) /
   `CloseStaleTimerEntriesJob` (2 h) close it even with no re-login. **Requires the Laravel
   scheduler / Horizon to be running in production.**

## Residual gap (documented, not a regression)

If the app is **not running** when uninstalled (macOS Trash / AppImage delete), no client code
runs — the timer is closed by layer 3 (server-side). The phantom tail after the last
heartbeat is discarded, never counted.

## Key files

- `desktop/src/main/index.js` — `startSelfRemovalWatcher()`, `--uninstall-stop` handling in the
  single-instance / `second-instance` path, reuses the `before-quit` graceful stop.
- `desktop/build/installer.nsh` — graceful `--uninstall-stop` before `taskkill /F`.
- `desktop/test/uninstall-stop.test.js` — unit test for the removal-trigger decision.

## Verify

```bash
cd desktop && npm test -- uninstall-stop
```

Manual (per OS, app running with a timer):
- **macOS**: drag `TrackFlow.app` to Trash → timer stops within a few seconds.
- **Windows**: run the uninstaller → app stops the timer, then exits.
- **Linux (.deb)**: `sudo apt remove trackflow` while running → watcher stops the timer.
- **Linux (AppImage)**: delete the AppImage while running → watcher stops the timer.
- App **not** running on uninstall → server reclaim/cleanup closes the entry (layer 3).
