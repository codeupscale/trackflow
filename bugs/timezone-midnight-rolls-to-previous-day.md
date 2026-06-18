# Timezone — Midnight (PKT) Tracked Time & Screenshots Roll Into the Previous Day

**Status:** ✅ FIXED 2026-06-17 (branch `chore/desktop-electron-42-upgrade`, uncommitted at time of writing)

## Resolution summary (2026-06-17)
- **Contributor A (default timezone):** the hardcoded `America/New_York` default is now `Asia/Karachi`
  for new orgs/users (`Organization::getDefaultSettings()`, `AuthController::register()`, the
  `users.timezone` column default, factories/seeders — committed earlier in `803f75d0`). The web
  register form now defaults to the **browser-detected** timezone and always offers it as a
  selectable option instead of silently falling back to a US zone
  (`web/src/app/(auth)/register/page.tsx`; `Asia/Karachi` also added to the curated list). Existing
  rows still carrying the old `America/New_York` default are re-pointed to `Asia/Karachi` by data
  migration `database/migrations/2026_06_17_000001_backfill_default_timezone_to_karachi.php`.
- **Contributor B (screenshot date folder):** the S3 date folder is now derived in the user's local
  timezone — `Carbon::parse($request->captured_at)->setTimezone($user->getTimezoneForDates())` —
  so an early-morning local screenshot is filed under the correct day (`ScreenshotController.php:78`).
  `captured_at` itself stays UTC.
- Display/date-filter paths were already timezone-aware via `getTimezoneForDates()`, so they are
  correct once the user's stored timezone is right (which the above ensures).

_Remaining minor follow-up:_ the desktop client does not yet push its device timezone on signup; it
relies on the existing user's stored zone (correct for this PKT workforce given the new default).

---

**Status (original):** 🔴 OPEN — not yet fixed
**Reported:** 2026-06-17 (dev in Pakistan, PKT / UTC+5)
**Investigated:** 2026-06-17 (read-only, on branch `chore/desktop-electron-42-upgrade`)
**Scope:** Backend (timezone resolution + screenshot date path) — surfaces in Web dashboard
**Severity:** P1 — tracked time and screenshots are attributed to the wrong calendar day.
Affects timesheets, dashboard "today", attendance, and screenshot grouping for any user east of
UTC who tracks in the early-morning hours.

## Reported symptom

A developer in Pakistan (PKT = UTC+5) tracked time at **~12:00 AM PKT**. The tracked time **and**
the screenshots show up under **yesterday** instead of today.

## Root cause

Storage is fine — timestamps are UTC everywhere (this matches the note in
[timer-sync-bugs.md](timer-sync-bugs.md), which already ruled out timezone *storage* as a bug).
The defect is in **which timezone is used to bucket a UTC timestamp into a calendar day**, and it
has two independent contributors:

### Contributor A (primary) — user's timezone defaults to `America/New_York`, not their real zone

The day-bucketing pipeline is correct *if it's given the right timezone*:
`User::getTimezoneForDates()` → `App\Support\TimezoneAwareDateRange` → UTC bounds.
But the timezone it's given is wrong for this dev.

On registration, when no timezone is supplied, both the org setting **and the user row** are
hardcoded to `America/New_York`:

- `app/Http/Controllers/Api/V1/AuthController.php:38` — org `settings.timezone = $request->timezone ?? 'America/New_York'`
- `app/Http/Controllers/Api/V1/AuthController.php:48` — `users.timezone = $request->timezone ?? 'America/New_York'`
- `app/Models/Organization.php:106` — `getDefaultSettings()` default timezone `America/New_York`
- `app/Models/User.php:215-230` — `getTimezoneForDates()` resolves user → org setting → `config('app.timezone')` (`UTC`, `config/app.php:68`)

So a Pakistani dev who never explicitly set their timezone has **`America/New_York`** stored.
New York is UTC−4/−5. **00:00 PKT June 17 = 19:00 UTC June 16 = ~14:00–15:00 New York on June 16.**
When the dashboard/report computes "today" or a date range in the user's (wrong) zone, that
activity falls on **June 16 — the previous day.** This explains why *both* time and screenshots
land on yesterday.

Bucketing call sites that consume the (wrong) timezone:
- `app/Http/Controllers/Api/V1/DashboardController.php:40,221` — `userTodayUtcBounds($tz)`
- `app/Http/Controllers/Api/V1/ScreenshotController.php:161-168` — screenshot list date filter uses `getTimezoneForDates()`

### Contributor B (secondary, genuine code bug) — screenshot S3 date folder is hardcoded UTC

Independent of any user timezone, the screenshot storage path derives its date from the raw
`captured_at` with **no timezone conversion**:

- `app/Http/Controllers/Api/V1/ScreenshotController.php:78` — `$date = Carbon::parse($request->captured_at)->format('Y-m-d')` (app tz = UTC)
- `app/Http/Controllers/Api/V1/ScreenshotController.php:80` — S3 key `"{org}/{user}/{$date}/{file}"`

The desktop sends `captured_at` as a **UTC ISO string**:
- `desktop/src/main/screenshot-service.js:935` and `:1003` — `new Date().toISOString()` (always `…Z`, i.e. UTC)

So a screenshot taken at 00:00 PKT (19:00 UTC the day before) is filed under the **previous day's**
S3 folder, even for a user whose timezone is set correctly. This is a latent path/date bug that
will keep mis-dating early-morning screenshots regardless of the Contributor A fix.

## Why it lands on "yesterday" — worked example (00:00 PKT, June 17)

| Representation | Value | Day |
|---|---|---|
| Local (dev) | 2026-06-17 00:00 PKT | June 17 ✅ |
| Stored (UTC) | 2026-06-16 19:00 UTC | June 16 |
| Bucketed in `America/New_York` (Contributor A) | 2026-06-16 ~15:00 EDT | **June 16 ❌** |
| Screenshot S3 folder from UTC (Contributor B) | `…/2026-06-16/…` | **June 16 ❌** |

## Reproduction

1. Register/login as a user whose `users.timezone` is `America/New_York` or UTC (i.e. not set to
   `Asia/Karachi`) — the default for anyone who didn't pick a timezone.
2. From a machine in PKT, track time and capture a screenshot between **00:00 and 05:00 PKT**.
3. Open the dashboard "today" / timesheet and the screenshots view for that day.
4. Time and screenshots appear under the **previous** day.

## Recommended fix

**Contributor A (do first — fixes the reported symptom):**
- Ensure each user's real timezone is captured and stored. The desktop/web client should send the
  device timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on register/login, and the
  user should be able to set it in profile (the field already exists — `ProfileController` /
  `AuthController:541-546`). Backfill existing affected users (e.g. set the Pakistani dev to
  `Asia/Karachi`).
- Reconsider the hardcoded `America/New_York` default at `AuthController.php:38,48` — prefer the
  client-supplied zone, falling back to UTC rather than a US zone.

**Contributor B (do alongside — prevents mis-filed screenshot dates):**
- Convert `captured_at` to the user's timezone before deriving the S3 date folder at
  `ScreenshotController.php:78`, e.g.
  `Carbon::parse($request->captured_at)->setTimezone($user->getTimezoneForDates())->format('Y-m-d')`.
- Keep storage/`captured_at` in UTC; only the *day bucket* should be timezone-aware.

**Verify after fixing:** grep for any other `format('Y-m-d')` / `whereDate` / `DATE_TRUNC` that
buckets a UTC timestamp without a timezone — payroll periods, attendance daily generation, and
report grouping are all date-sensitive and could share Contributor B's pattern.

## Notes / open questions

- Decide the source of truth for a user's day: **individual user timezone** (best for distributed
  teams — recommended) vs **organization timezone**. The code already prefers user → org → UTC;
  the problem is the *value*, not the precedence.
- All `file:line` references were accurate on 2026-06-17 on branch
  `chore/desktop-electron-42-upgrade`; re-verify before fixing.
