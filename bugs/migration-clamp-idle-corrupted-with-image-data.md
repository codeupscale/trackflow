# Migration file corrupted with embedded image data (breaks all migrations + tests)

**Status:** ✅ FIXED (2026-06-30, `develop`) — branch `fix/reports-export-and-attendance-absent-staff`.

**Scope:** `backend/database/migrations/2026_06_24_000001_clamp_idle_auto_stop_min_to_4h.php`.

**Severity:** P0 (tooling) — `php artisan migrate` and the **entire** PHPUnit suite fail to parse; blocks fresh DB setup / CI on affected checkout.

## Symptom

```
PHP Parse error: syntax error, unexpected token ":", expecting "{"
  in .../2026_06_24_000001_clamp_idle_auto_stop_min_to_4h.php on line 25
```

Every test errored at bootstrap (RefreshDatabase couldn't migrate). The file was **605 KB** instead of ~2.4 KB.

## Root cause

Commit `eba31d29` ("fix(desktop): reassign counts the full away duration…") accidentally pasted a base64/binary **screenshot blob into the migration file**, concatenated right after `return new class extends Migration`. The desktop commit had nothing to do with this migration — pure accidental corruption that was committed. The clean version existed in commit `032aeeb6` (2410 bytes).

## Fix

Restored the clean file from history:

```
git show 032aeeb6:backend/database/migrations/2026_06_24_000001_clamp_idle_auto_stop_min_to_4h.php \
  > backend/database/migrations/2026_06_24_000001_clamp_idle_auto_stop_min_to_4h.php
```

`php -l` clean; full migration + 58 targeted tests run.

## Prevention

- Scanned for other corruption: `grep -rl "data:image/png;base64" backend/{app,database,routes,config}` — none; no other oversized PHP files.
- Consider a CI guard rejecting PHP files containing `data:image/.*;base64` or above a sane size.

## Key files

- `backend/database/migrations/2026_06_24_000001_clamp_idle_auto_stop_min_to_4h.php`
