# CI — 5 Timer PHPUnit failures blocked the production API image (full-suite deploy gate)

**Status:** ✅ FIXED 2026-07-06 (branch `fix/timer-suite-failures` → merged `develop`)
**Reported:** 2026-07-05 (prod Build & Deploy run, PHP 8.4, full suite)
**Scope:** Backend — `TimerService::todayTotal()` + 3 Timer feature tests
**Severity:** P0 (release blocker) — `.github/workflows/deploy.yml` gates the production API image on a green full PHPUnit suite; 5 red tests blocked the API deploy.

## Impact

- The **2026-07-04 release shipped web-only**. The API image + **15 pending migrations** were blocked because the deploy workflow refuses to build/publish the API image while the full suite is red.
- Root organisational cause: **CI/dev asymmetry**. `deploy.yml` runs the *full* suite as a hard gate, but the **dev pipeline runs no tests at all**. Red tests therefore accumulated on `develop` unnoticed — including **2 failures that had been explicitly documented as "known pre-existing"** (memory note `backend-test-run-setup`) and carried forward instead of being fixed. "Known-red" tests are indistinguishable from new regressions at the gate.

## The 5 failures — per-failure root cause (test bug vs code bug)

| # | Test | Verdict | Root cause |
|---|------|---------|-----------|
| 1 | `TimerServiceTest::test_pause_stops_timer_without_creating_idle_entry` | **TEST bug** | `pause()` was redesigned into a **soft pause** (marks Redis state `paused`, leaves the entry OPEN so elapsed freezes and `resume()` continues the same entry). At old main (`969e97a5`) `pause()` was literally `return $this->stop()`. The test still asserted the old "pause = stop" contract (`ended_at !== null`). |
| 2 | `TimerServiceTest::test_today_total_excludes_running_entries_without_ended_at` | **CODE bug (regression)** | `todayTotal()` was refactored to call `findOpenRunningEntry()`, which **self-heals from the DB even when no Redis key exists** — so an orphaned open entry (crashed/evicted session, no Redis key) had its elapsed added, inflating today's total by up to `MAX_ENTRY_DURATION`. At old main, elapsed was added **only** `if ($timerData = Redis::get(...))`. The Redis key is the authoritative "running" signal; a Redis-less open row is an orphan and must not count. Got `3600`, expected `0`. |
| 3 | `TimerSyncTest::test_status_falls_back_to_db_when_redis_key_missing` | **TEST bug** | Asserts `elapsed_seconds > 0`, but the test **starts a timer and immediately queries `status()`** with no time elapsed. `elapsed_seconds` is whole seconds (`(int) diffInSeconds` — fractional truncation is correct behaviour), so a same-tick start→status is legitimately `0`. Its sibling test in the same commit (`test_pause_freezes_elapsed_and_resume_restores_running`) uses `$this->travel(120)`; this one forgot to advance the clock. |
| 4 | `TimerTest::test_can_start_timer` | **CODE bug — same root cause as #2** | `Mockery\InvalidCountException`: `Redis::get` "should be called exactly 2 times but called 3 times". The `todayTotal()` self-heal path added an extra `Redis::get` (via `getRedisTimerMeta()`) **and** an extra `Redis::setex` (self-heal write) beyond what the start flow's exact Redis mock allowed. |
| 5 | `TimerTest::test_employee_can_start_timer_on_assigned_project` | **CODE bug — same root cause as #2** | Identical `InvalidCountException` from the same extra `todayTotal()` Redis calls. |

**3 of the 5 are one code regression.** #2, #4 and #5 all trace to `todayTotal()` calling `findOpenRunningEntry()` (self-heal) instead of gating on a live Redis key. Fixing `todayTotal()` fixes all three — and because the extra Redis calls disappear, the `TimerTest` mock counts (`get` ×2, `setex` ×1) become correct again with **no test change**.

## The fix

**Code** — `backend/app/Services/TimerService.php`, `todayTotal()`: add the running timer's elapsed **only when a Redis timer key exists**, resolving the entry from `getRedisTimerMeta()['entry_id']` (a `whereNull('ended_at')` lookup) instead of the self-healing `findOpenRunningEntry()`. This restores old-main "running = Redis-backed" semantics while preserving the newer pause-freeze logic. `status()`/`stop()` still own Redis self-heal from the DB; a pure read like `todayTotal()` must not resurrect orphans.

**Tests:**
- `TimerServiceTest` — renamed `test_pause_stops_timer...` → `test_pause_freezes_timer_without_creating_idle_entry`; asserts the entry stays OPEN (`ended_at` null), Redis state is `paused`, and no idle entry is created.
- `TimerSyncTest::test_status_falls_back_to_db_when_redis_key_missing` — `$this->travel(5)->seconds()` after start so elapsed is deterministically non-zero.
- `TimerTest` — unchanged (fixed transitively by the `todayTotal()` code fix).

## Evidence / verification

- Full suite **before** (`phpunit.local.xml`, pg 5433 + throwaway redis 6380): 5 failures + 2 errors = the exact CI 5.
- Full suite **after**: the 5 are gone. `647 tests` — delta is exactly the 5 target failures.
- Root cause confirmed at `app/Services/TimerService.php` `todayTotal()` (self-heal path) and `git show 969e97a5:.../TimerService.php` (old-main Redis-gated path).

## Known follow-up (NOT part of the 5, pre-existing, out of scope)

Two tests are **wall-clock / timezone date-boundary flakes**, unrelated to this change:
`ScreenshotTest::test_screenshot_filters_by_date_range` and
`TimerServiceTest::test_status_stopped_with_project_returns_scoped_today_total_but_global_all_projects_total`.

- They fail **identically on original code** and in **pristine single-method isolation** — so not pollution and not caused by this fix.
- Root cause: `UserFactory`/`OrganizationFactory` default timezone `Asia/Karachi` (UTC+5). When the suite runs while UTC time is in the ~19:00–24:00 window (it was `22:41 UTC` / `03:41 PKT` during this fix), the user's local "today" is a day ahead of UTC, so `now()->subHours(4)` and UTC-serialized `captured_at` land in the "wrong" day and the date assertions skew. CI passed them by running at a safe UTC hour — which is exactly why they were never in the CI failure list.
- **Recommended fix (separate change):** pin the clock in these two tests (`Carbon::setTestNow(<fixed non-boundary instant>)` with a `tearDown` reset, matching the CheckIn test pattern) so they are deterministic at any hour.

## Prevention

1. **Run the full PHPUnit suite in the dev workflow too**, not only at the deploy gate — the gate should never be the first place a red test is seen.
2. **Never carry "known-red" tests.** A documented-as-known failure still blocks the deploy gate and masks new regressions. Fix or (only if genuinely incomplete) mark incomplete — do not leave plain red.
3. Prefer **behaviour assertions over exact external-call-count mocks** where practical; brittle `Redis::shouldReceive()->twice()` counts turn legitimate refactors into red tests.
