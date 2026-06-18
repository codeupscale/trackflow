# Desktop — Main window timer freezes at inflated value (includes idle threshold) when idle prompt appears

**Status:** 🟢 FIXED
**Reported:** 2026-06-18 (user)
**Investigated / Fixed:** 2026-06-18
**Scope:** Desktop agent (Electron) — idle detection ↔ main popup timer display
**Severity:** P2 — display/UX defect, no data loss (the kept/discarded duration is computed elsewhere). The frozen number the user sees during the idle prompt is wrong by the idle-threshold amount.

## Symptom (as reported)

> "After 5 minutes idle the idle window appears and the main window pauses the timer (good), but it is not showing the time as of when idle *started* — it's showing the time *including* the threshold that was set to trigger the idle window."

So when the idle prompt pops up after the 5-minute threshold, the main window's timer correctly stops ticking, but it freezes showing the elapsed time **including** the 5 idle minutes. It should freeze at the moment idle *began* — i.e. with the idle threshold period excluded — because that idle interval is not yet counted (it is pending the user's Keep / Discard / Reassign decision).

## Root cause

The main popup window's timer is driven entirely by the per-second `timer-tick` IPC from the main process (`startTrayTimer`, `desktop/src/main/index.js:2835-2858`). The renderer has no independent clock — it just renders the last `totalSeconds`/`formatted` it received (`desktop/src/renderer/index-renderer.js:187-196`).

When idle is detected (`onIdleDetected`, prompt policy, `index.js:965-1008`):

1. `stopTrayTimer()` (`index.js:977`) halts the tick interval. The popup display therefore **freezes at the last tick value**, which is the full current elapsed — *including* the idle-threshold minutes.
2. The **tray** text is then corrected to a frozen value that subtracts the idle seconds (`frozenSeconds`, `index.js:1003-1006`):
   ```js
   const frozenSeconds = _cachedStartedAtMs
     ? todayTotalCurrentProject + Math.max(0, Math.floor((Date.now() - _cachedStartedAtMs) / 1000) - idleSeconds)
     : todayTotalCurrentProject;
   setTrayText(`⏸ ${formatTimeShort(frozenSeconds)}`);
   ```
3. **But the popup window was never sent this corrected value.** The tray shows the right frozen time (idle excluded); the main window shows the wrong one (idle included). They disagree by exactly the idle threshold (≈5 min).

## Fix

After computing `frozenSeconds`, push **one** corrected `timer-tick` to the popup so its display freezes at the same idle-start value as the tray. Because `stopTrayTimer()` already halted the interval, this is a single terminal update — the display then stays frozen until the user resolves the prompt, at which point `startTrayTimer()` resumes and the next live tick (computed from `_cachedStartedAtMs`) overwrites it.

`desktop/src/main/index.js`, in the prompt branch of `onIdleDetected` (right after `setTrayText`):

```js
// Freeze the MAIN WINDOW display at the same idle-start value as the tray.
// stopTrayTimer() above halted the per-second ticks, so without this the popup
// stays frozen at the LAST tick — which still includes the idle-threshold period
// (the ~5 min that triggered the prompt). Push one corrected tick so the popup
// matches the tray: frozen at the moment idle began, threshold excluded. The idle
// interval is not counted yet (pending keep/discard/reassign).
if (popupWindow && !popupWindow.isDestroyed()) {
  popupWindow.webContents.send('timer-tick', {
    totalSeconds: frozenSeconds,
    formatted: formatTimeShort(frozenSeconds),
    activityScore: 0,
    lastScreenshotAt: _lastScreenshotAt,
    isOnline: networkMonitor?.isOnline ?? true,
  });
}
```

Notes:
- The renderer's `onTimerTick` guards `if (!isRunning) return;` — at idle-detection time the timer is still running (only paused for the prompt), so the corrected tick is applied. ✅
- `formatTimeShort` and the renderer's own `formatTime` both produce `HH:MM:SS`, so the frozen text is consistent. ✅
- On resolve (keep/discard/reassign/auto-stop) `startTrayTimer()` re-arms and recomputes from `_cachedStartedAtMs`, so the frozen value is naturally replaced — no stale state. ✅

## Files cited (verified on branch `develop`, 2026-06-18)

| What | Location |
|---|---|
| Idle detection → tray freeze (prompt policy) | `desktop/src/main/index.js:965-1008` |
| `frozenSeconds` computation + `setTrayText` | `desktop/src/main/index.js:1003-1006` |
| Tick driver (single source of truth for popup) | `desktop/src/main/index.js:2832-2859` |
| `formatTimeShort` | `desktop/src/main/index.js:2784-2790` |
| Renderer `onTimerTick` handler | `desktop/src/renderer/index-renderer.js:187-196` |
| `idleStartedAt = now - systemIdleSec*1000` (correct) | `desktop/src/main/idle-detector.js:317` |
