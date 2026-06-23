# Manual Idle/Reassign Test Plan — desktop agent

Account: **mirza.blade@yopmail.com** (dev) — user_id `019eeeb7-345e-7154-9789-e675824f95ac`
Target: dev stack (`infra-tf-dev-*`), DB `trackflow_dev` on `ssh trackflow`.

## Scenario A — KEEP idle time (online → offline → back online)
Track running total after every step.

1. Install the app, log in.
2. Start timer. Work/keep active for **5 min**.
3. Stop all activity → wait for the **idle window** to trigger.
4. Click **Keep** idle time. ← record total
5. **Disconnect internet.** Wait **5 min** idle. Click **Keep**. ← record total
6. Still offline, wait **5 min** idle. **Reconnect internet.** Click **Keep**. ← record total

Expected: every minute is counted exactly once; no gaps, no double counts; offline
keeps reconcile on reconnect with no duplicates.

## Scenario B — REASSIGN idle time (same online/offline sequence)
Repeat steps 2–6 but choose **Reassign** (to another project) instead of Keep.

**Reported symptom: with Reassign, the time tracking always breaks here.**

What to watch for in the DB (known suspects):
- Reassigned `tracked` entry landing on the **origin** project instead of the chosen
  target (dropdown not sending selected project_id → `POST /timer/report-idle`).
- Double-count between the `idle` audit entry and the `tracked` reassigned entry.
- Offline reassign not reconciling / creating duplicates on reconnect.
- today_total mismatch between desktop widget and server (`todayTotal()` = tracked + ended only).

## How we verify
Poll `trackflow_dev` every ~10 min via `/tmp/tf-mirza-monitor.sh` (untracked; holds dev
creds). Each poll: list all of today's entries (type, window, duration, project,
open/closed), the official server today_total, and live Redis timer state. Compare
against the running totals the tester noted at each step; any divergence = bug to fix.
