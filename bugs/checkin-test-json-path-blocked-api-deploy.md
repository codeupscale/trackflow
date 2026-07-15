# CI — 2 mis-pathed CheckInTest assertions blocked the production API image for a week

**Status:** ✅ FIXED 2026-07-15 (branch `fix/checkin-test-error-message-json-path` → `develop` → `main`)
**Reported:** 2026-07-15 (manager/QA asked to confirm the Project-Time + Manual-Entry-approval features were live on prod — they were not)
**Scope:** Backend — `tests/Feature/Hr/CheckInTest.php` (test-only; production code correct and untouched)
**Severity:** P1 (silent release blocker) — `.github/workflows/deploy.yml` gates the production **API image** on a green PHPUnit suite; 2 red tests blocked every API deploy while **web kept deploying**, so prod ran a stale backend undetected.

## Impact

- Two features merged to `main` on **2026-07-07** — **Manual Time Entry approval workflow** (`ManualTimeEntryService`, `time-entries/pending|approve|reject`) and the **PM Project-Time report + CSV/PDF export** (`ProjectTimeReportService`, `reports/project-time`, `reports/project-time/export`) — were **absent from production for ~8 days** despite being in `main`.
- The prod API ran an image built **2026-07-06** (`ghcr.io/codeupscale/trackflow-api:latest`), while the prod **web** image was current (built 2026-07-08). The dashboard pages for both features existed, but every backend call 404'd — "in main but not on prod."
- **Silent failure mode:** the 2026-07-08 `main` push ("Merge branch 'develop'") failed at the PHPUnit gate. `deploy.yml` builds services **independently** and gates each on its own tests: `build-api` `needs: [changes, test-backend]`, `build-web` `needs: [changes, test-frontend]`. Frontend tests passed → **web built and deployed**; backend tests failed → `build-api` was skipped. The workflow's later "success" runs (web-only commits) reinforced the illusion that prod was current.

## Root cause — test bug, not code bug

Two check-out guidance tests asserted the error string at the **top-level `message`** JSON key:

- `test_checkout_after_lunch_without_recheck_in_explains_desktop_timer`
- `test_checkout_without_check_in_mentions_desktop_timer`

But the API error envelope for `abort(422, …)` nests the message under **`error.message`**. `CheckInService` signals both cases via `abort(422, $this->checkoutUnavailableMessage($user))` (`backend/app/Services/CheckInService.php:725`, messages at `:754`/`:757`), and the global handler renders every `HttpException` as `{ "error": { "code": …, "message": $e->getMessage() } }` — see the `HttpException` branch in `backend/bootstrap/app.php:104-116`. So `$response->json('message')` was `null`:

```
Failed asserting that null is identical to
  'You are already checked out. …'
Failed asserting that null is identical to
  'No open check-in found. …'
Tests: 2 failed, 4 incomplete, 706 passed
```

Every **other** 422 check-out assertion in the same file already used the correct path — e.g. `assertJsonPath('error.message', 'You already have an open check-in. Please check out first.')` (`CheckInTest.php:151`, `:502`). These two were the only outliers; the message strings themselves matched the code exactly, so it was purely a wrong assertion path.

## The fix

`tests/Feature/Hr/CheckInTest.php` — change the two assertions from `assertJsonPath('message', …)` to `assertJsonPath('error.message', …)`, matching the API envelope and the rest of the file. **No production code changed** — the endpoint already returned the correct message at the correct path (the web UI consumes `error.message`).

## Evidence / verification

- Failed prod deploy: `gh run view 28949732157` — `Backend tests (PHPUnit)` ❌ → `Build API image` skipped; `Build Web image` ✅ + `Deploy to production` ✅ (web-only).
- Same 2 failures still on `main` at report time: nightly `Tests` run `29378522555` (2026-07-15), `PHP 8.4` job — identical 2 CheckInTest failures.
- After fix: standalone `Tests` on `develop` (`29412732010`) → `PHP 8.4` **success**; prod `Build & Deploy` (`29412985818`) → `Backend tests` ✅ → `Build API image` ✅ → `Deploy to production` ✅ (rolling restart + health check).
- Live prod confirmation (`infra-tf-app-1`, restarted 2026-07-15, healthy): `ManualTimeEntryService.php` + `ProjectTimeReportService.php` present; `route:list` shows `time-entries/pending|approve|reject` and `reports/project-time` + `/export`; `add_approval_workflow_to_time_entries` migration Ran (batch 18).

## Prevention

1. **Run the full PHPUnit suite in the dev workflow, not only at the prod deploy gate.** `deploy-dev.yml` has **no** PHPUnit gate — it only builds/deploys — so a red backend test is invisible until it silently skips the prod API build. This is the **same organizational root cause** as [ci-timer-suite-failures-blocking-api-release.md](ci-timer-suite-failures-blocking-api-release.md): CI/dev test asymmetry.
2. **"Web deployed" ≠ "backend deployed."** Because services build independently and gate on their own tests, a green Build & Deploy run can still have skipped `build-api`. Verify the **running API image / `route:list`** on `infra-tf-app-1`, not just the workflow checkmark.
3. **Never carry known-red tests.** These 2 sat red on `main` through 8 nightly `Tests` failures; a documented-or-not red test still blocks the deploy gate and masks new regressions.
4. Consider **failing the deploy loudly when a service's tests are red but its paths changed**, rather than silently skipping the build — a skipped API build should not read as a successful deploy.
