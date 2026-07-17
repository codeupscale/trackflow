# Manual Idle/Sleep Test Plan — desktop agent

Account: **mirza.blade@yopmail.com** (dev) — user_id `019eeeb7-345e-7154-9789-e675824f95ac`
Target: dev stack (`infra-tf-dev-*`), DB `trackflow_dev` on `ssh trackflow`.

> **Rewritten 2026-07-16.** The previous plan's Scenario A (Keep) and Scenario B
> (Reassign) are obsolete — both actions were removed from the idle popup and are
> now refused server-side (403 `IDLE_CREDIT_DISABLED`). Discard is the only action.

## Prerequisites

- Desktop build from `fix/desktop-sleep-autostop-and-idle-enforcement` (or later)
  **installed** — the sleep fix lives in the agent and cannot be exercised through
  the API.
- Org `idle_timeout` = **10** (migration `2026_07_16_000001`). Confirm in
  Settings → Idle detection, or in `organizations.settings`.
- **Why dev is the honest test:** the Laravel scheduler is DISABLED on dev, so the
  server-side `timer:cleanup-stale` backstop never runs. The desktop is therefore
  the ONLY thing that can stop a timer here. On prod that 4h cleanup would mask a
  desktop-side failure and make a broken fix look like it works.

---

## Scenario A — Long sleep (THE 20-HOUR BUG) ⭐ primary

1. Start timer. Stay active ~2 min. Note the total.
2. Note the wall-clock time of your **last keystroke** — call it `T_last`.
3. Sleep the laptop (close the lid) for **> 10 min** (15 min is enough; no need to
   wait overnight — the code path is identical).
4. Wake the laptop.

**Expected**
- Timer is **STOPPED**, with a notification: "Timer stopped at <T_last> because
  your computer went to sleep."
- Tray/popup total does **NOT** include the sleep gap.
- DB: the entry's `ended_at` ≈ `T_last` (back-dated), **not** the wake time.
- No new entry opens on wake.

**Fail signals (the old bug)** — timer still running on wake; total jumped by the
sleep duration; `ended_at` = wake time.

## Scenario B — Short sleep (policy preserved) ⭐ primary

1. Start timer, stay active ~2 min.
2. Sleep the laptop for **< 10 min** (e.g. 3 min). Wake.

**Expected**
- Timer is **STILL RUNNING**; elapsed includes the short gap. Screenshots and
  activity resume. **No** auto-stop, **no** notification.

This is the 2026-07-07 owner policy (lunch / meetings must not stop the timer).
If this stops, the fix is too aggressive.

## Scenario C — Idle popup has only Discard

1. Start timer. Stop touching keyboard/mouse for **10 min** (do NOT sleep).

**Expected**
- Idle popup appears at ~10 min (not 5).
- **Only "Discard Idle Time"** is present. No Keep, no Reassign, no project dropdown.
- Press **K** and **R** → nothing happens. Press **D** → discards and stops.
- DB: `type='idle'` audit entry created; original entry closed at idle start.

## Scenario D — Server refuses idle credit (the bypass)

With a valid token for the dev account:

```bash
curl -si -X POST https://<dev-api>/api/v1/timer/idle \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"time_entry_id":"<uuid>","idle_started_at":"<20m ago>",
       "idle_ended_at":"<5m ago>","idle_seconds":900,"action":"keep"}'
```

**Expected:** `403` + `"code":"IDLE_CREDIT_DISABLED"`. Same for `action=reassign`
(and **no** new time entry is written). `action=discard` must still work — it is
the honest path and must not be blocked.

## Scenario E — Offline regression (unchanged paths)

1. Start timer, go offline, work 5 min, come back online.
   → Time reconciles once; no duplicates; no gaps.
2. Offline, idle 10 min, Discard, reconnect.
   → Discard replays once; totals match server.

Watch for: double counting between the `idle` audit entry and tracked entries;
`today_total` mismatch between desktop widget and server.

---

## Known rollout hazard (verify, don't be surprised by)

An **older** desktop build treats ANY error from `POST /timer/idle` as a network
error: it queues the payload and **resumes the timer**, crediting the idle time.
So an old build clicking Reassign against the new backend gets a misleading
"Network error" toast and keeps the time. That is why `min.agent` gates
`timer/start` (forcing an upgrade before a session begins) and deliberately does
**not** gate `timer/idle` or `timer/stop`. The offline queue drops the item after
5 attempts, so it is bounded, not a poison pill.

## How we verify

Poll `trackflow_dev` every ~10 min via `/tmp/tf-mirza-monitor.sh` (untracked; holds
dev creds). Each poll: list all of today's entries (type, window, duration, project,
open/closed), the official server `today_total`, and live Redis timer state. Compare
against the running totals noted at each step; any divergence = bug to fix.

Useful check for Scenario A (entry must be back-dated, not wake-dated):

```sql
SELECT started_at, ended_at, duration_seconds, type
FROM time_entries
WHERE user_id = '019eeeb7-345e-7154-9789-e675824f95ac'
ORDER BY started_at DESC LIMIT 5;
```
