# Bug Reports — TrackFlow

Investigated defects across the desktop agent, web dashboard, and Laravel backend. Each file
documents symptom, scope, severity, root cause, evidence (`file:line`), and fix recommendation
or resolution summary.

> **Verdict on timer architecture:** The local-first timer design is _sound_ and does **not**
> need a rewrite. Most timer bugs were implementation defects in the sync layer — targeted fixes,
> not a redesign.

## Status legend

| Marker | Meaning |
| ------ | ------- |
| 🔴 OPEN | Not fixed — still actionable |
| 🟡 | Partial fix or needs product decision / follow-up |
| ✅ FIXED | Resolved on `develop` (unless the report notes otherwise) |

Verify `file:line` references still match the codebase before implementing from an older report.

## Index

| File | Area | Severity | Status / symptom |
| ---- | ---- | -------- | ---------------- |
| [attendance-present-marked-absent-utc-bucketing.md](attendance-present-marked-absent-utc-bucketing.md) | Backend HR attendance | P1 | 🟡 PRIMARY FIXED — employee timezone day window; overlap bucketing / open entries / heartbeat thresholds still tracked as follow-ups |
| [auth-and-idle-bugs.md](auth-and-idle-bugs.md) | Desktop auth + idle | P1 | ✅ FIXED — volatile MAC-based token key forced re-login every restart; idle popup intermittent (spurious detector restart) |
| [desktop-project-list-not-loading-and-unassigned-start.md](desktop-project-list-not-loading-and-unassigned-start.md) | Desktop renderer + tray | P1 | ✅ FIXED (2026-06-22) — project dropdown stuck disabled after slow load; Start re-enabled without a project; tray started unassigned. Re-enable select after load + project-required guard + tray no "No Project" |
| [dev-scheduler-disabled-prod-ok.md](dev-scheduler-disabled-prod-ok.md) | Infra / scheduler (dev vs prod) | ℹ️ | REFERENCE (verified 2026-06-22) — Laravel scheduler RUNS in prod (offline-cleanup backstop OK) but is DISABLED on dev by design; validate scheduled-cleanup/uninstall-delay paths on prod or via manual `timer:cleanup-stale`, not dev |
| [electron-42-screen-permission-regression.md](electron-42-screen-permission-regression.md) | Desktop / macOS screen permission | P0 | 🔴 OPEN — Electron 42 `desktopCapturer.getSources()` rejects; app may not register in Screen Recording list (blocks upgrade) |
| [offline-online-sync-hardening.md](offline-online-sync-hardening.md) | Desktop + Backend offline↔online | P0–P1 | ✅ FIXED (2026-06-22) — pre-release audit batch: cleanup truncated offline work (now 4h grace + extend-on-late-stop); offline idle re-anchor + anti-resurrection; offline heartbeats/screenshots dropped (422); keep-offline left server paused; processHeartbeat/reportIdle hardened; orphaned idle detector. P2/P3 ordering/idempotency deferred |
| [idle-autostop-countdown-wrong.md](idle-autostop-countdown-wrong.md) | Desktop idle alert countdown | P1 | ✅ FIXED — footer showed absurd values (e.g. 8584:14); countdown uses grace after popup shown, not idle start |
| [idle-reassign-desktop-time-inflated.md](idle-reassign-desktop-time-inflated.md) | Desktop idle reassign/discard ↔ local anchor | P1 | ✅ FIXED (2026-06-22) — desktop showed ~25m vs web ~14m after reassign; local timer_sessions row not re-anchored to idle-end, reconcile reverted anchor via never-move-forward guard. Offline-while-reassigning variant tracked as follow-up |
| [idle-entries-counted-in-timesheet-attendance.md](idle-entries-counted-in-timesheet-attendance.md) | Backend timesheet + attendance | P1 | ✅ FIXED (2026-06-22) — idle audit entries summed as worked time (reassign creates idle+tracked duplicate); TimesheetController + AttendanceService now exclude `type=idle`; factory default `tracked` |
| [idle-keep-last-ss-indicator-stale.md](idle-keep-last-ss-indicator-stale.md) | Desktop screenshot indicator | P2 | ✅ FIXED — "Last SS …" stale/empty after idle Keep or app-startup resume; callback now registered on all `screenshotService.start()` paths |
| [idle-keep-time-not-added.md](idle-keep-time-not-added.md) | Desktop idle "Keep" action | P2 | 🟡 PARTIAL — pause/resume freezes web elapsed during idle; keep retains idle time by design; stale-action trap shows user-visible error |
| [idle-popup-frozen-time-includes-threshold.md](idle-popup-frozen-time-includes-threshold.md) | Desktop main popup timer display | P2 | ✅ FIXED — timer froze including idle threshold minutes; now freezes at idle-start elapsed |
| [idle-reassign-empty-projects.md](idle-reassign-empty-projects.md) | Desktop idle reassign dropdown | P1 | ✅ FIXED — empty project list on idle reappear; 30 min cached projects, no blocking API on slow internet |
| [phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md) | Desktop main ↔ renderer timer | P1 | ✅ FIXED — server-sync paths no longer discard unsynced local-first session; sync-loop stop carries `_stateVersion` |
| [single-desktop-session.md](single-desktop-session.md) | Backend auth + desktop agent | P0 | ✅ FIXED (2026-06-22) — last-login-wins: new desktop login terminates prior desktop sessions + closes orphaned timer (phantom tail discarded). Replaces the 409 reject that could lock users out after uninstall/crash; web + one desktop still coexist |
| [tech-debt.md](tech-debt.md) | Stack versions (all codebases) | P1–P3 | 🔴 OPEN — Electron 28 EOL (security); PHP 8.2 aging |
| [timer-reset-after-break-phantom-stop.md](timer-reset-after-break-phantom-stop.md) | Desktop + Backend `/timer/status` | P0 | ✅ FIXED — timer jumped to ~0 after long break; Redis-missing status phantom-stopped desktop; `get-timer-state` bypassed local anchor |
| [timer-sleep-hard-auto-stop.md](timer-sleep-hard-auto-stop.md) | Desktop power events | P0 | ✅ FIXED — hard auto-stop on sleep/lock/shutdown; startup gap via `lastActiveAt`; no overnight counting |
| [timer-sync-bugs.md](timer-sync-bugs.md) | Desktop + Backend timer sync | P0–P2 | ✅ FIXED — weak-internet wrong durations, session clashes, stop targeting; shared start/stop contract + idempotency |
| [timer-window-pin-blur-and-dpi-shrink.md](timer-window-pin-blur-and-dpi-shrink.md) | Desktop timer popup (pin/blur/DPI) | P1 | ✅ FIXED — pin suppresses blur-to-hide; popup re-asserts bounds on show (Windows fractional DPI) |
| [timezone-midnight-rolls-to-previous-day.md](timezone-midnight-rolls-to-previous-day.md) | Backend timezone + screenshots | P1 | ✅ FIXED — default `Asia/Karachi`, web device tz, backfill, timezone-aware S3 date folders |
| [uninstall-stop-timer-cross-platform.md](uninstall-stop-timer-cross-platform.md) | Desktop uninstall (all OSes) + backend | P0 | ✅ FIXED (2026-06-22) — timer kept running after uninstall; runtime self-removal watcher (mac/Linux) + graceful Windows NSIS `--uninstall-stop` + backend reclaim. No OS has a universal uninstall hook; server cleanup is the backstop |
| [unsynced-start-stuck-tracking-desync.md](unsynced-start-stuck-tracking-desync.md) | Desktop ↔ `/timer/status` | P1 | ✅ FIXED — sync loop pushes unsynced local start via reconcile; desktop "Tracking" vs web "Not tracking" desync |
| [web-timezone-save-empties-sidebar.md](web-timezone-save-empties-sidebar.md) | Web auth/permissions ↔ sidebar | P1 | ✅ FIXED — `fetchUser()` no longer wipes permissions on transient errors; timezone save merges locally |

## Workflow

1. **Before fixing** — read this index and the relevant `bugs/*.md` file for root cause and recommended fix.
2. **When a new bug is found** — add or extend a report (one file per issue area).
3. **After a fix is merged** — update the report status to `✅ FIXED` (or `🟡` for partial), add resolution summary with date/branch, and refresh this index table.

## How these were found

- **2026-06-15** — Read-only timer sync investigation (`desktop/src/main/`, `TimerService.php`, `TimerController.php`).
- **2026-06-16 – 2026-06-19** — Auth, idle, timezone, HR attendance, web permission state, desktop session enforcement, and power/sleep fixes documented as they were investigated and merged to `develop`.
