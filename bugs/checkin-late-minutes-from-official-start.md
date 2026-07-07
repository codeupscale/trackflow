# Check-in "Late" minutes measured from official start instead of the late threshold

**Status:** ✅ FIXED (2026-07-07) · **Severity:** P2 (wrong HR data) · **Area:** Backend HR check-in

## Symptom

With the default policy (`check_in_time = 11:30`, `late_threshold = 11:45`), an employee clocking in at
**12:12 PM** was shown **Late 42m** on the attendance list — lateness counted from 11:30, the official
start. Owner expectation: the grace window up to the threshold is free, so lateness should count from
the **late threshold** → 12:12 − 11:45 = **27m**.

## Root cause

`CheckInService::checkIn()` decided *whether* a check-in is late against `$lateAt` (the threshold) but
computed *how many* minutes from `$officialStart`:

```php
$isLate = $local->gt($lateAt);
$lateMinutes = $isLate ? (int) $officialStart->diffInMinutes($local) : 0;   // ← 11:30 basis
```

So the two settings disagreed: status used the threshold, magnitude used the official start.

## Fix

`backend/app/Services/CheckInService.php` — late minutes now measured from the threshold:

```php
$lateMinutes = $isLate ? (int) $lateAt->diffInMinutes($local) : 0;
```

Boundary behavior unchanged: exactly `11:45:00` is still `on_time` / 0 minutes. Historical
`check_in_late_minutes` values written before this fix keep the old 11:30 basis (owned by the first
check-in of the day, never recomputed); no backfill was performed.

Tests updated in `backend/tests/Feature/Hr/CheckInTest.php` (11:50 check-in now expects 5m late,
not 20m; 4 tests + comments).
