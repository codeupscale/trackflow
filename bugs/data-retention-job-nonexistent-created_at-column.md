# `EnforceDataRetentionJob` fails every night — `activity_logs.created_at` does not exist

| | |
|---|---|
| **Area** | Backend scheduled job / data retention |
| **Severity** | P2 |
| **Status** | ✅ FIXED (2026-07-30) |
| **Found** | 2026-07-30, while investigating an unrelated check-in report — spotted in prod `failed_jobs` |

## Symptom

`App\Jobs\EnforceDataRetentionJob` landed in prod `failed_jobs` on **every** nightly run
(04:00 UTC, `enforce-data-retention` in `routes/console.php:124`). Verified on prod for
07-26, 07-27, 07-28, 07-29, 07-30 — 5 consecutive nights, and by inspection it has never
succeeded since the job was written.

```
PDOException: SQLSTATE[42703]: Undefined column: 7
ERROR: column "created_at" does not exist
LINE 1: ... "activity_logs" where "organization_id" = $1 and "created_a...
```

## Root cause

`activity_logs` has **no `created_at`/`updated_at` columns and never has.**

- `0001_01_01_000009_create_activity_logs_table.php` creates `logged_at` and no
  `timestamps()`.
- `App\Models\ActivityLog` sets `public $timestamps = false;`.
- `logged_at` is the only time column, and it is the one the
  `(organization_id, logged_at)` index covers.

The job filtered on `created_at`:

```php
$activityDeleted = ActivityLog::where('organization_id', $org->id)
    ->where('created_at', '<', now()->subDays($activityDays))   // ← column doesn't exist
    ->delete();
```

**Blast radius was wider than the activity prune.** The throw happened inside the
per-org `chunk()` loop, which aborted `handle()` before reaching the global audit-log
prune at the bottom of the method — so the 2-year `audit_logs` retention had also
**never run**.

### Why nothing visibly piled up

The default 90-day activity-log prune is actually performed by a *different*, working
job: `PruneOldActivityLogsJob` (scheduled 02:00, dispatched per org), which correctly
uses `logged_at`. Prod confirms it works — 829,606 `activity_logs` rows with the oldest
at 2026-05-04, right on the 90-day boundary. And `audit_logs` held only 1,600 rows with
the oldest at 2026-03-18, well inside the 2-year window. So the failure was pure noise
in `failed_jobs` rather than unbounded growth — but both retention guarantees were
unenforced.

### Why it was never caught

Zero test coverage. `tests/Feature/Enterprise/DataPrivacyTest.php` never referenced the
job or `ActivityLog`.

## Fix

`backend/app/Jobs/EnforceDataRetentionJob.php`:

1. **`created_at` → `logged_at`** on the activity-log query — the actual bug.
2. **Do not apply a default retention window.** The pre-fix code defaulted to 90 days for
   *every* org. Simply repairing the column would have introduced a **new** data-loss
   bug: `PruneOldActivityLogsJob` deliberately exempts `plan === 'pro'` orgs from
   pruning (unlimited retention), and a fixed 04:00 job would have deleted their history
   two hours later, behind that job's back. This job now prunes activity logs **only**
   when the org sets an explicit `data_retention_config.activity_log_retention_days`;
   unconfigured orgs are left entirely to the 02:00 job, which owns both the 90-day
   default and the plan policy. No prod org currently sets the config, so the fix is a
   no-op on today's data.
3. **Per-org failures are contained** in a `try`/`catch` that logs
   `data_retention.org_failed`, so one malformed org can no longer abort the sweep and
   skip the audit prune — the exact failure mode above.
4. **Chunked deletes** (1000/statement, matching `PruneOldActivityLogsJob`) instead of
   one unbounded `DELETE`, so a large backlog can't hold a long lock or blow the timeout.
   Laravel's `PostgresGrammar::compileDeleteWithJoinsOrLimit()` compiles
   `->limit(n)->delete()` to `delete … where ctid in (select …)`, so this is valid on PG.
5. **Invalid windows rejected** — a non-numeric or `< 1` value logs
   `data_retention.invalid_retention_days` and deletes nothing, rather than treating the
   cutoff as "now" and wiping the table.
6. **Explicit `withoutGlobalScopes()`** on the activity, audit and organization queries.
   `GlobalOrganizationScope` is a no-op when unauthenticated so this was harmless in the
   scheduler, but it would have silently scoped the sweep if ever dispatched from a web
   request. Matches the convention in `PruneOldActivityLogsJob`.
7. **Job standard compliance** (CLAUDE.md §3) — added the missing `$timeout = 600` and
   `$backoff = [60, 300, 900]`; `$tries` and `failed()` were already present.
8. `chunk(50)` → `chunkById(50)` on the org sweep.

## Tests

New: `backend/tests/Feature/Jobs/EnforceDataRetentionJobTest.php` — 9 tests, all passing:

- job completes without a DB error (the regression guard)
- prunes activity logs older than the configured window
- retention window is measured on `logged_at`
- org without explicit config is left untouched (the `pro`-plan exemption guard)
- prunes audit logs older than 2 years
- a failing org does not prevent the audit prune
- invalid retention window deletes nothing
- backlog larger than one chunk is fully pruned
- pruning is scoped to the configured organization

## Follow-up / residual

- **Overlapping responsibility remains.** `PruneOldActivityLogsJob` (02:00) and
  `EnforceDataRetentionJob` (04:00) both prune `activity_logs`, now with a clean split
  (default+plan policy vs. explicit per-org config). Consolidating them into one job
  with one policy would be the cleaner end state — see `bugs/tech-debt.md`.
- **`PruneOldActivityLogsJob` exempts only `plan === 'pro'`.** Prod's sole data-bearing
  org is `enterprise`, which is therefore pruned at 90 days. If enterprise is meant to
  have unlimited retention too, that predicate needs widening — a separate product
  decision, not touched here.
- The prod `failed_jobs` rows from the 5 failed nights are still present and can be
  cleared once the fix deploys.
