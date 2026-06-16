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

## How these were found

Read-only investigation across the desktop agent (`desktop/src/main/`) and the Laravel backend
(`backend/app/Services/TimerService.php`, `TimerController.php`) on 2026-06-15. All file:line
references were accurate at that time — verify they still match before fixing.
