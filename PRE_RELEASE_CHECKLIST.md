# TrackFlow — Pre-Release Checklist (Production)

Run this before cutting a production release. Order: **gates → desktop regression → core flows → cross-platform → backend/web → release mechanics → post-deploy**. Do not skip the regression section — it covers the exact bugs fixed in the last cycle.

---

## 0. Build & CI gates (must all pass)
- [ ] `develop` is green on CI (`.github/workflows/tests.yml`): PHPUnit + `composer audit` + `npm audit`.
- [ ] Desktop: `cd desktop && npm test` → **all suites pass** (currently 484).
- [ ] Web: `cd web && npm run build && npx tsc --noEmit` → no errors.
- [ ] Backend: `php artisan config:cache && php artisan route:cache && php artisan optimize` succeed.
- [ ] Version bumped in `desktop/package.json`; changelog/release notes drafted.
- [ ] Build is off the **merged develop** (confirm the fixes below are in the binary, not just the repo).

## 1. Regression — fixes from the last cycle (verify in the ACTUAL new build)
These were found/fixed this cycle. A fix in git is not a fix in the binary until rebuilt.
- [ ] **Duplicate auto-stop notification** (`fix/desktop-duplicate-autostop-notification`): close laptop lid / lock screen while timer runs → **exactly ONE** "Timer auto-stopped" toast (not two). Wording reads "Timer stopped at HH:MM because your computer was locked/went to sleep. All time tracked before then was saved."
- [ ] **Orphaned heartbeat queue loop** (`fix/desktop-orphaned-heartbeat-queue-loop`): run an **offline reassign** (below), then watch the log — no endless `Holding heartbeat — entry not synced yet (entry=undefined)` every 5s. Orphans get dropped, queue drains to 0.
- [ ] Confirm the offline queue (`offline-queue.db`) returns to 0 rows after reconnect in all offline flows.

## 2. Timer core
- [ ] Start / stop / start again — no duplicate entries; `today_total` increments correctly.
- [ ] Rapid double-click Start → only one entry (start mutex).
- [ ] Stop while offline → entry saved locally, reconciles on reconnect with **no duplicate**.
- [ ] `today_total` matches sum of tracked (ended) entries + live running elapsed.
- [ ] Tray title + popup total stay in sync with the dashboard.

## 3. Idle handling (the high-risk area — test all 6)
For each: note the on-screen total before/after; verify in DB total is preserved and no double-count (idle rows are type=`idle`, excluded from total).
- [ ] **Keep — online**: idle minutes counted, single entry continues, no new rows.
- [ ] **Discard — online**: idle dropped from total; one `idle` audit row created; timer resumes.
- [ ] **Reassign — online (same project)**: behaves like Keep (no other project) — total preserved.
- [ ] **Reassign — online (cross-project)**: reassigned `tracked` row lands on the **chosen** project (not origin); idle audit stays on origin; **timer continues on the original project** (reassign moves the idle chunk only, it does NOT switch your active project).
- [ ] **Keep/Reassign — OFFLINE → reconnect**: disconnect → idle → choose action → reconnect. Verify: reassigned time on correct project, total preserved, and **NO duplicate entries** after reconciliation.
- [ ] New project assigned mid-session appears in the reassign dropdown within a reasonable time (note: list is cached ~30 min — known UX gap; restart shows it immediately).

## 4. Sleep / wake / lock
- [ ] Sleep (lid close) with timer running → timer auto-stops at sleep onset; overnight gap **not** tracked; single notification.
- [ ] Wake after long sleep → timer stays stopped; `reconcileTimerState()` runs; queue flushes; no resurrected timer.
- [ ] Lock/unlock without sleep → auto-stop fires once; unlock does not double-count.
- [ ] App killed/crashed with open timer → on next launch, stale session closed at last-active (startup gap), not at "now".

## 5. Offline / network resilience
- [ ] Drop network mid-tracking → timer keeps running locally; heartbeats/screenshots queue.
- [ ] Reconnect → queue flushes (backoff 5/15/30/60/120s), drains to 0, no duplicate entries/screenshots.
- [ ] **Transient network error during token refresh does NOT log the user out** (only a real 401/403 on refresh does). Pull network during a request → user stays authenticated.
- [ ] 5xx / timeout on timer start/stop → request fails but timer continues locally; no logout.

## 6. Auth & multi-tenancy
- [ ] Single-org login, multi-org login (org selector), and org switch all issue correct tokens.
- [ ] Google OAuth (desktop system-browser flow) succeeds; invitation auto-accept works.
- [ ] Logout cleans up: timer state, all services, listeners, intervals, offline queue, token file (no cross-user leakage).
- [ ] Spot-check data isolation: a user only ever sees their own org's data (timer, projects, reports).

## 7. Cross-platform desktop (REQUIRED — must work on all three)
Run §2–§5 smoke on each:
- [ ] **macOS** — screenshots use window-capture first (no wallpaper-only bug); no keychain popups (AES-256-GCM token storage).
- [ ] **Windows** — `net.isOnline()` + ping fallback works; screenshots capture; no duplicate entries.
- [ ] **Linux (Ubuntu 22.04+/Wayland)** — PipeWire screen capture (real pixels, not black); portal picker appears once per session.

## 8. Backend & web smoke
- [ ] API p95 < 200ms on key endpoints (timer status, reports); list endpoints paginate (no unbounded `get()`).
- [ ] Dashboard first paint < 2s; charts render; role-based nav hides unauthorized sections (no content flash).
- [ ] HR modules load (leave/attendance/payroll/shifts) for the roles that should see them.
- [ ] Reports/exports match the raw time entries for a known user/day.

## 9. Release mechanics & auto-update
- [ ] Build signed installers for mac/win/linux; `latest-mac.yml` / `latest.yml` manifests generated and uploaded to the GitHub Release.
- [ ] Auto-update: install **previous** prod version, publish new release, confirm it detects + downloads + applies the update and relaunches cleanly.
- [ ] Production env vars present (`TRACKFLOW_GOOGLE_CLIENT_ID/SECRET`, API URL, etc.).
- [ ] DB migrations reviewed; run on a staging copy first; have a rollback plan.
- [ ] Tag the release; release notes list the two desktop fixes from this cycle.

## 10. Post-deploy verification (production)
- [ ] Health checks green after rolling restart; Horizon workers running; scheduler active (prod only).
- [ ] Real device: install the released build, run one full **track → idle reassign (online + offline) → sleep auto-stop → stop** cycle; verify totals in the dashboard match.
- [ ] Watch logs ~30 min for: `Holding heartbeat` spam, duplicate auto-stop toasts, `ECONNABORTED` storms, unexpected logouts. None should appear.
- [ ] Verify a couple of real users' `today_total` reconciles (server = desktop = web).

---

### Known open items to decide before release
- ✅ **Upstream heartbeat fix — DONE** (2026-06-23): offline heartbeats now carry the live entry's local id + idempotency_key (`ActivityMonitor.getCurrentEntryMeta`), so offline activity **replays** on reconnect instead of being dropped. See [bugs/desktop-offline-heartbeat-orphan-queue-loop.md](bugs/desktop-offline-heartbeat-orphan-queue-loop.md). Re-verify in the build: offline track → reconnect → heartbeat activity for that session appears server-side.
- ✅ **Project-list refresh — DONE** (2026-06-23): popup + reassign dropdown force a throttled refresh on open, so newly assigned projects appear without restart; 30-min cache kept as offline fallback. See [bugs/desktop-new-project-not-shown-until-restart.md](bugs/desktop-new-project-not-shown-until-restart.md).
