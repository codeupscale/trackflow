# Manual test plan — offline-first time sync

Covers the refactor in `bugs/offline-first-time-sync-refactor.md`. Work through this on
**dev** before any production push.

The single question this plan answers: **can tracked time be lost, duplicated, or
mis-attributed under any realistic condition?** Everything else is secondary.

---

## 0. What pushing `develop` triggers automatically

Two workflows fire **in parallel** on the same push:

| Workflow             | Trigger paths                    | Effect                                                                |
| -------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `deploy-dev.yml`     | `backend/**`, `web/**`, `marketing/**` | Builds `:dev` images → deploys to `dev.trackflow.codeupscale.com` → **runs migrations** |
| `desktop-release.yml`| `desktop/**`                     | Publishes a **prerelease** `v1.0.46-dev.N` (preflight auto-bumps past the last released version, so this is NOT package.json's `1.0.43`), built with `TRACKFLOW_API_URL=https://dev.trackflow.codeupscale.com/api/v1` |

This change touches both, so both run.

> **Expect a gap.** The backend deploys before the desktop build finishes. In that
> window the legacy endpoints are already gone, so **any older desktop build pointing at
> dev cannot track** — `POST /timer/start` returns 404. That is the intended
> force-upgrade, arriving early. Tell anyone testing on dev to stop tracking until they
> install the new `-dev.N` prerelease.

`TIMER_MIN_AGENT_VERSION` must stay **empty** throughout. Do not set it on dev or prod
until a desktop build has rolled out.

---

## 1. Environment

| Thing                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| Dev API              | `https://dev.trackflow.codeupscale.com/api/v1`               |
| Dev containers       | `infra-tf-dev-app-1`, `infra-tf-dev-horizon-1`               |
| Dev DB               | `trackflow_dev` (creds in `infra-tf-dev-app-1` env)          |
| Server               | `ssh trackflow`                                              |
| Desktop build        | GitHub Releases → prerelease **`v1.0.46-dev.3`** (from merge `3b8fc48b`) |
| Local session store  | macOS `~/Library/Application Support/TrackFlow/offline-queue.db`<br>Windows `%APPDATA%\TrackFlow\offline-queue.db`<br>Linux `~/.config/TrackFlow/offline-queue.db` |

**Inspect the desktop's local truth** (the table is `timer_sessions`):

```bash
sqlite3 ~/Library/Application\ Support/TrackFlow/offline-queue.db \
  "SELECT substr(idempotency_key,1,8) uuid, started_at, ended_at, duration_seconds,
          revision, synced_revision, substr(server_entry_id,1,8) srv, confirmed_at
     FROM timer_sessions ORDER BY started_at;"
```

Read it as: **dirty** iff `synced_revision` is null or `<> revision`. **Purgeable** only
when closed + `server_entry_id` + `confirmed_at` + `synced_revision = revision`.

**Inspect the server's copy:**

```bash
ssh trackflow "docker exec infra-tf-dev-app-1 php artisan tinker --execute='
  \App\Models\TimeEntry::withoutGlobalScopes()
    ->whereNotNull(\"client_revision\")->latest(\"started_at\")->take(20)
    ->get([\"idempotency_key\",\"started_at\",\"ended_at\",\"duration_seconds\",\"client_revision\",\"client_synced_at\",\"project_id\"])
    ->each(fn(\$e) => print(\$e->toJson().PHP_EOL));'"
```

**Desktop logs** — every sync cycle logs `[SessionSync]`, splits log
`[WorkSessionStore] Split live session across N midnight boundary(ies)`.

---

## 2. Pre-flight (before touching the UI)

| #   | Check                                | Command                                                                          | Pass                                    |
| --- | ------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------- |
| 0.1 | Dev API up                           | `curl -s https://dev.trackflow.codeupscale.com/api/v1/health/live`                | `{"status":"ok"}`                       |
| 0.2 | Migration applied                    | `ssh trackflow "docker exec infra-tf-dev-app-1 php artisan migrate:status \| grep client_sync"` | `Ran`                     |
| 0.3 | New columns exist                    | `\d time_entries` on `trackflow_dev`                                              | `client_revision`, `client_synced_at`   |
| 0.4 | Sync endpoint registered             | `php artisan route:list --path=timer`                                             | `timer/sessions/sync` present           |
| 0.5 | **Legacy endpoints gone**            | same                                                                              | no `start`/`stop`/`switch`/`pause`/`resume`/`idle` |
| 0.6 | `TIMER_MIN_AGENT_VERSION` unset      | `docker exec infra-tf-dev-app-1 printenv \| grep TIMER_MIN` | empty or absent        |

If 0.5 fails the deploy did not take the new backend image — see the partial-build
gotcha in §7.

---

## 3. Core: offline-first (the reason this refactor exists)

Each case: **no time may be lost, duplicated, or shifted.** Compare the desktop total,
the local SQLite rows, and the web dashboard — all three must agree.

### 3.1 Track fully offline, then reconnect
1. Sign in, **turn Wi-Fi off**.
2. Start a timer on a project. Work ~10 min. Stop.
3. Inspect local SQLite → one row, `ended_at` set, `synced_revision` **null** (dirty).
4. Confirm **zero** network calls were attempted (logs show `[SessionSync] skipped: unreachable`).
5. Wi-Fi **on**. Within ~60 s (or immediately — reconnect triggers a sync).

**Pass:** entry appears on the web dashboard with the **real offline start time**, not
the reconnect time. Duration matches to the second. `confirmed_at` populates locally.

### 3.2 Offline project switch
Offline: start on project A → after ~5 min switch to B → work ~5 min → stop. Reconnect.

**Pass:** two entries, **contiguous** (A's `ended_at` == B's `started_at`), correct
projects, no overlap, no gap.

### 3.3 Crash recovery mid-session, still offline
Offline, timer running → force-quit the app (Activity Monitor / Task Manager kill) →
relaunch, **still offline**.

**Pass:** timer restores as running, anchored at its **true original start** — the
elapsed counter continues, it does not restart from zero.

### 3.4 Long offline stretch — **the case that was previously impossible**
Track a session, then keep the machine offline **> 24 h** (or set the session's
`started_at` back >24 h in local SQLite). Reconnect.

**Pass:** uploads successfully. Before this refactor `MAX_PAST_SKEW` rejected it
outright with a 422 and the time was stranded forever. Repeat at ~5 days to exercise the
30-day window.

### 3.5 Sign out with unsynced time
Offline → track → stop → **sign out** while still offline → sign back in (online).

**Pass:** the unsynced session survives sign-out and uploads on next sign-in. Verify
before signing back in that the row is still in local SQLite.

### 3.6 Quit with unsynced time
Same as 3.5 but quit the app (tray → Quit / Cmd+Q) instead of signing out.

**Pass:** time survives and uploads on next launch.

---

## 4. Midnight split — highest-risk new behaviour

This did not exist before. It rewrites live sessions, so test it hard.

### 4.1 Simple crossing
Set the machine clock to **23:57**, start tracking, let it cross 00:00, stop at ~00:03.

**Pass:**
- Two entries: one ending exactly at 00:00:00, one starting exactly at 00:00:00 — **contiguous**.
- Neither spans two days.
- Per-day report totals are correct on both days; they sum to the full elapsed.
- **Expected UI:** the elapsed counter resets at midnight (the session genuinely
  restarted) and so does the day total. This is correct, not a bug.

### 4.2 Sleep across midnight
Start tracking ~23:50, sleep the machine, wake ~00:30.

**Pass:** split applied on the first tick after resume; rows contiguous; no single row
spans the boundary.

### 4.3 Multi-day (weekend simulation)
Start tracking, sleep the machine, wake **3 days later** (or set the clock forward 3
days with the timer running).

**Pass:** one row **per calendar day**, all contiguous, none spanning a boundary. Logs
show `Split live session across 3 midnight boundary(ies)`.

### 4.4 Timezone correctness — **do not skip**
Set the machine timezone to something well away from the org timezone (e.g. machine
`America/New_York`, org `Asia/Karachi`).

**Pass:** the split happens at **org-local** midnight, not machine-local. Verify the
per-day totals in the web report (which uses the org zone) show no bleed. Getting this
wrong mis-attributes hours for anyone travelling, and it would be invisible in a
same-timezone test.

---

## 5. Idle

Only **discard** and **stop** exist (keep/reassign disabled by owner policy 2026-07-16).

### 5.1 Continue tracking
Let the idle prompt appear, wait a few minutes with it open, click **Continue tracking**.

**Pass:** pre-idle work is credited **up to idle-start**; the idle gap belongs to no
entry; the desktop total matches the web dashboard exactly. (The historic bug was
desktop ~20 m vs portal ~16 m — measuring to idle-*end* double-counts the gap.)

### 5.2 Stop timer from the idle prompt
**Pass:** the session closes at **idle-start**, not at click time. Dead time is not billed.

### 5.3 Idle while offline
Trigger idle with Wi-Fi off, answer the prompt, reconnect.

**Pass:** resolves entirely locally (no network attempt), and the split syncs correctly.
The entry may become **shorter** on the server than a previously-synced value — that is
correct for a discard.

### 5.4 Idle across sleep
Idle prompt showing → sleep → wake.

**Pass:** the prompt re-appears with the same idle start; the decision is not lost.

---

## 6. Live behaviour, screenshots, resilience

### 6.1 Web dashboard live indicator
Start tracking (online). Within ~60 s the **web dashboard** should show the user as
currently tracking (this reads `GET /timer/status`, backed by the Redis key the sync path
now maintains). Stop → dashboard clears.

### 6.2 Today-total includes manual entries
Add a **manual** time entry via the web UI while the desktop is running.

**Pass:** the desktop's "Today, all projects" reflects it (this is why the desktop still
reads `/timer/today-total`).

### 6.3 Offline screenshots
Track offline long enough for screenshot intervals to fire, reconnect.

**Pass:** screenshots appear attached to the right entries. Ordering matters here —
sessions must sync before screenshots, or the shots 422. Check none were dropped.

### 6.4 Activity score
**Pass:** stopped entries have a sensible non-null `activity_score` (finalized from
ActivityLog on close).

### 6.5 Server unreachable mid-session
While tracking, stop the dev API (`docker stop infra-tf-dev-app-1`) for ~5 min, then start it.

**Pass:** tracking is completely unaffected; logs show backoff (30 s → 60 s → 2 m …);
on recovery everything uploads. **No time lost.**

### 6.6 Reverb outage — regression guard for the P0 found in E2E
Stop the Reverb/websocket container while tracking, then sync.

**Pass:** sessions **still upload**. Before the fix, broadcasting inside the sync
transaction meant a Reverb outage rolled back the write and silently blocked all time
upload. Server log should show `[TimeEntrySync] Broadcast failed (session already stored)`
— a warning, not a failure.

### 6.7 Cross-platform
Repeat **3.1, 4.1, 5.1** on **macOS, Windows and Linux**. Platform differences are a
recurring source of desktop bugs; the sync path is shared but the clock/sleep/idle paths
are not.

---

## 7. Cannot be tested on dev — verify by other means

- **Scheduler is prod-only.** `compose.production.yaml` defines `tf-scheduler` with no
  dev equivalent, so `timer:cleanup-stale` and `CloseStaleTimerEntriesJob` **never fire
  on dev**. To exercise the "cleanup closed my entry early, then the agent extends it
  back" path, trigger it manually:
  ```bash
  ssh trackflow "docker exec infra-tf-dev-app-1 php artisan timer:cleanup-stale"
  ```
  Then sync from the desktop and confirm the entry is **extended forward**, not left truncated.

- **05:00 purge** is client-side and fires on the org-timezone boundary. To test without
  waiting: set `sync_meta.last_purge_at` back in local SQLite and restart the app.
  ```sql
  UPDATE sync_meta SET value = '0' WHERE key = 'last_purge_at';
  ```
  **Pass:** only confirmed, closed, >24 h-old rows are deleted. Live and dirty rows survive.

- **Partial-build gotcha:** `deploy.yml` builds only *changed* services and gates the API
  image on PHPUnit. A failing test can ship web while leaving the backend on a stale
  image. After any deploy, re-run pre-flight **0.5** — if the legacy endpoints are still
  present, the backend image did not update.

---

## 8. Go / no-go for production

Do not push to prod unless **all** hold:

- [ ] Every §3 case passes — no time lost, duplicated, or time-shifted
- [ ] §4.1 and §4.4 pass — splits are contiguous and use the **org** timezone
- [ ] §5.1 passes — desktop and web totals agree exactly after an idle discard
- [ ] §6.5 and §6.6 pass — outages delay uploads but never lose time
- [ ] §6.7 — core cases pass on all three platforms
- [ ] No `[SessionSync]` errors and no rows stuck dirty after a successful cycle
- [ ] Local and server totals reconcile for the whole test period

## 9. Production rollout order — **load-bearing**

1. **Backend first.** Merge to `main`, deploy. `TIMER_MIN_AGENT_VERSION` stays **empty**.
   Old desktop builds lose tracking the moment this lands, so keep the window short.
2. **Release the desktop build**, promote from prerelease to stable.
3. **Wait for adoption.** Watch agent-version telemetry until old builds are gone.
4. **Only then** set `TIMER_MIN_AGENT_VERSION`.

Setting step 4 early locks every user out of tracking.

**Rollback:** the migration is additive (two nullable columns + a partial index) and safe
to leave in place. Rolling the API image back restores the legacy endpoints; desktop
builds from this refactor would then have no working write path, so roll the desktop back
too, or roll forward instead.
