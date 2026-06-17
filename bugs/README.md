# Known Bugs — Timer Sync Layer

This folder tracks known, investigated bugs that are **not yet fixed**. Each file documents
root cause, evidence (file:line), and the recommended fix so future work can address them.

> **Verdict on architecture:** The local-first timer design is *sound* and does **not** need a
> rewrite. The bugs below are implementation defects in the sync layer — targeted fixes, not a
> redesign.

## Index

| File | Area | Severity | Symptom |
|------|------|----------|---------|
| [timer-sync-bugs.md](timer-sync-bugs.md) | Desktop + Backend timer sync | P0–P2 | Wrong durations on weak internet, incorrect displayed time, new session clashing with old |
| [tech-debt.md](tech-debt.md) | Stack versions (all 3 codebases) | P1–P3 | Electron 28 end-of-life (security); PHP 8.2 aging |
| [electron-42-screen-permission-regression.md](electron-42-screen-permission-regression.md) | Desktop / macOS screen permission | P0 (blocks upgrade) | Electron 42 `desktopCapturer.getSources()` rejects → app never registers in Screen Recording list |
| [auth-and-idle-bugs.md](auth-and-idle-bugs.md) | Desktop auth + idle | P1 | ✅ FIXED — re-login on every restart (volatile MAC-based key); idle popup intermittent (spurious detector restart) |
| [timezone-midnight-rolls-to-previous-day.md](timezone-midnight-rolls-to-previous-day.md) | Backend timezone + screenshot date path | P1 | ✅ FIXED — default tz → `Asia/Karachi`, web detects device tz, existing rows backfilled, screenshot S3 date folder now timezone-aware |
| [phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md) | Desktop main ↔ renderer timer state | P1 | ✅ FIXED — server-sync paths no longer discard an unsynced local-first session; sync-loop stop carries `_stateVersion`; Start re-broadcasts running state (desktop 437/437 green) |
| [unsynced-start-stuck-tracking-desync.md](unsynced-start-stuck-tracking-desync.md) | Desktop main ↔ Backend `/timer/status` | P1 | ✅ FIXED — sync loop now *pushes* (not just keeps) an unsynced local start via reconcile when online, so a transiently-failed `POST /timer/start` with no network transition no longer leaves desktop "Tracking" while web shows "Not tracking" (desktop 441/441 green) |
| [attendance-present-marked-absent-utc-bucketing.md](attendance-present-marked-absent-utc-bucketing.md) | Backend HR attendance generation | P1 | 🟡 PRIMARY FIXED — day window now uses the employee's timezone (no more present→absent); Causes B/C/D (overlap bucketing, open entries, threshold/heartbeat) tracked as follow-ups |

## How these were found

Read-only investigation across the desktop agent (`desktop/src/main/`) and the Laravel backend
(`backend/app/Services/TimerService.php`, `TimerController.php`) on 2026-06-15. All file:line
references were accurate at that time — verify they still match before fixing.
