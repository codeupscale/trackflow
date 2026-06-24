# Desktop — Windows project dropdown selection lost / flicker

**Area:** Desktop agent renderer (main popup) — `projectSelect` in `index-renderer.js`  
**Severity:** P1 on Windows (cannot pick a project → cannot start timer); P2 on macOS/Linux (same code path, not reported)  
**Status:** ✅ FIXED (2026-06-23) — two causes: (1) `loadProjects()` innerHTML rebuild on unchanged list; (2) pin keepalive `moveTop()` every 300ms on Windows dismissed native `<select>` popup (pin defaults on at install)

## Symptom (Windows, QA)

Reported alongside [desktop-phantom-tracking-stale-local-session-cross-account.md](desktop-phantom-tracking-stale-local-session-cross-account.md):

1. Project dropdown **flashes** options (~2s) then appears empty or snaps back to placeholder.
2. User **cannot complete a selection** — native dropdown closes mid-pick or choice does not stick.
3. Dropdown control sometimes renders **with no visible label text** ("Select Project" button empty) — likely a separate Windows/Chromium rendering issue; tracked here as follow-up.

macOS/Linux: same unconditional-rebuild code existed but this symptom has not been reproduced there.

## Adversarial review — selection path

### What does **not** explain the bug alone

| Path                                                                               | Why it is insufficient                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `change` → `syncTimerState()` → `loadProjects()` → rebuild                         | `change` fires **after** the pick completes. Rebuild restores `currentValue` from `projectSelect.value` (lines 300–310). Selection should stick unless something else races. |
| `syncTimerState()` overwriting `projectSelect.value` from `state.entry.project_id` | When stopped, main sets `currentEntry = null` (`index.js` ~2881), so no overwrite. While running, dropdown is disabled.                                                      |
| Empty API response                                                                 | Handled: keeps existing options when `list.length === 0 && options.length > 1` (~273–278).                                                                                   |

### Root cause B — pin keepalive `moveTop()` on Windows (confirmed by QA)

Fresh installs default to **pinned** (`loadAlwaysOnTop()` returns `true`). `_applyAlwaysOnTop()` started a **300ms interval** on **all platforms** that called `setAlwaysOnTop` + `moveTop()` to work around macOS Sequoia z-order loss.

On Windows, opening a native `<select>` creates a separate listbox HWND. Polling `moveTop()` on the parent `BrowserWindow` steals z-order from that popup and **closes the dropdown within ~1s** (every 300ms tick). Unpinning (middle titlebar icon) stops the symptom — matches QA observation.

**Fix:** restrict the 300ms keepalive to `process.platform === 'darwin'` only; Windows/Linux get one-shot `setAlwaysOnTop(true)`. Also skip `moveTop()` in `showPopup()` on Windows.

### Root cause A — unconditional `loadProjects()` rebuild (renderer)

`loadProjects()` **always** did `projectSelect.innerHTML = …` on every call, recreating all `<option>` nodes even when the project list was identical.

`loadProjects()` is invoked from:

| Trigger                                            | File:line                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `init()`                                           | `index-renderer.js:409`                                                |
| `syncTimerState()` (first line)                    | `index-renderer.js:220`                                                |
| `change` on project select (when stopped)          | `index-renderer.js:434`                                                |
| `onSyncTimer` IPC                                  | `index-renderer.js:605` ← fired every popup show                       |
| `onProjectsReady` IPC                              | `index-renderer.js:611–613` ← fired every popup show                   |
| `showPopup()` also calls `refreshProjectsOnOpen()` | `index.js:2416–2418` → second `projects-ready` when cache &gt; 60s old |

On **every tray/popup open**, main sends **both** `sync-timer` and `projects-ready` in the same `setImmediate` (`index.js:2409–2412`). That alone causes **two** `loadProjects()` calls back-to-back.

On Windows, mutating `<select>` options while the **native dropdown popup is open** is known to dismiss the popup and drop in-progress selection. The user opens the list → a background `loadProjects()` rebuild fires → native menu closes → pick never lands.

This is the same class of bug fixed for idle reassign in [idle-reassign-dropdown-selection-reset.md](idle-reassign-dropdown-selection-reset.md) (`idle-alert.js` — skip rebuild when list unchanged + preserve selection).

### Remaining uncertainty (honest gaps)

- Root cause B (pin keepalive) was **confirmed on Windows by QA** — unpinning stops the symptom. Root cause A (rebuild) was a complementary defect on the same code path, fixed defensively rather than from a Windows log trace.
- **Order-only API changes** (same ids, different sort) still trigger rebuild — rare; would still disrupt an open dropdown.
- **Renamed projects** with same ids skip rebuild — display name stale until ids change; acceptable.
- **Empty option text** on Windows may be DPI/CSS/Chromium, not `innerHTML` — needs separate investigation.

## Fix

### A. Renderer — skip rebuild when list unchanged (`index-renderer.js`)

1. Compare existing option ids (excluding placeholder) to incoming list ids.
2. If identical and options already exist, **return early** (still call `syncProjectSelectEnabled()` / `updateStartBtnState()`).
3. On actual rebuild, preserve `currentValue` and restore if still valid (existing behaviour).

### B. Main — macOS-only pin keepalive (`index.js` `_applyAlwaysOnTop`)

- 300ms `moveTop()` interval runs **only on darwin** (macOS Sequoia z-order workaround).
- Windows/Linux: one-shot `setAlwaysOnTop(true)` — no polling.
- `showPopup()` calls `moveTop()` only on macOS.

```281:298:desktop/src/renderer/index-renderer.js
    // Skip the rebuild when the project list is unchanged. loadProjects() runs on
    // init, every syncTimerState() (incl. the one fired right after a `change`),
    // polls and the projects-ready signal — rebuilding the <select> each time
    // destroys/recreates its <option>s. On Windows that disrupts an in-progress
    // selection (closes the native dropdown), so the user can never complete a
    // pick. Only rebuild when the set of project ids actually changed.
    const existingIds = Array.from(projectSelect.options)
      .map(o => o.value)
      .filter(v => v !== '');
    const newIds = list.map(p => String(p.id));
    const sameList = existingIds.length === newIds.length
      && existingIds.every((id, i) => id === newIds[i]);
    if (sameList && projectSelect.options.length > 1) {
      _loadProjectsInFlight = false;
      syncProjectSelectEnabled();
      updateStartBtnState();
      return;
    }
```

## Verification

QA confirmed root cause B on Windows (unpin → dropdown stays open). Regression coverage added in `desktop/test/pin-keepalive.test.js`. Recommended re-checks:

1. `cd desktop && npm test` — full suite green.
2. **Windows manual:**
    - Login → open popup → open project dropdown → pick a project → selection sticks, Start enables.
    - Repeat while popup was just opened from tray (exercises `sync-timer` + `projects-ready` burst).
    - New project assigned on web → reopen popup within 60s → new project appears without breaking an in-progress pick.
3. Optional: DevTools console — confirm `[loadProjects]` does not precede a failed pick; no duplicate rebuild logs when list unchanged.

## Key files

- `desktop/src/renderer/index-renderer.js` — `loadProjects()`, `syncTimerState()`, IPC listeners
- `desktop/src/main/index.js` — `showPopup()`, `refreshProjectsOnOpen()`, `projects-ready` / `sync-timer` emits
- `desktop/src/renderer/idle-alert.js` — prior art for same fix pattern

## Related reports

- [idle-reassign-dropdown-selection-reset.md](idle-reassign-dropdown-selection-reset.md) — same root cause, idle reassign surface (✅ fixed)
- [desktop-project-list-not-loading-and-unassigned-start.md](desktop-project-list-not-loading-and-unassigned-start.md) — stuck-disabled dropdown (✅ fixed); complementary
- [desktop-phantom-tracking-stale-local-session-cross-account.md](desktop-phantom-tracking-stale-local-session-cross-account.md) — co-reported Windows dropdown flicker (phantom timer ✅ fixed; dropdown tracked here)
