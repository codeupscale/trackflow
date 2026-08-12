# Seeded demo accounts carry retired role names → empty permission map on a fresh machine

**Status:** ✅ FIXED (`develop`)
**Severity:** High — a new developer cannot get a working non-owner login from a fresh checkout
**Area:** Backend — `database/seeders/DatabaseSeeder.php`, RBAC
**Found:** 2026-08-05

## Symptom

On a **new** dev machine, `php artisan migrate --seed` completed successfully, but:

1. `admin@acme.com` and `manager@acme.com` signed in and landed on a dashboard with
   nothing on it — every nav item and page gated away.
2. There was no HR or Finance login at all, so the entire HR module (leave, payroll,
   attendance policy, employee records) could not be exercised locally by anyone except
   the owner.

It looked like "login is broken". Authentication was fine; **authorization** resolved to
an empty set.

## Root cause

Two independent gaps that compound.

### 1. The seeder wrote role names that no longer exist

Migration [`2026_05_13_000004_update_roles_for_new_matrix.php`](../backend/database/migrations/2026_05_13_000004_update_roles_for_new_matrix.php)
consolidated the system roles to `owner` / `org_manager` / `hr_manager` /
`finance_manager` / `employee`, and migrates old data forward:

```php
DB::table('users')->where('role', 'admin')->update(['role' => 'org_manager']);
DB::table('users')->where('role', 'manager')->update(['role' => 'org_manager']);
```

On a fresh `migrate --seed` the **migrations all run before the seeder**, against an empty
`users` table. That UPDATE matches zero rows. `DatabaseSeeder` then *re-introduced* the
retired names, writing `'admin'` and `'manager'` into `users.role`.

`PermissionService::buildPermissionMap()` resolves a user's permissions by matching that
string against a system role
([`PermissionService.php:252-258`](../backend/app/Services/PermissionService.php#L252-L258)):

```php
$roleModel = Role::where('organization_id', $user->organization_id)
    ->where('name', $rawRole)
    ->where('is_system', true)
    ->first();
```

`'admin'` and `'manager'` match nothing → `$map` stays `[]` → zero permissions.

Only two of the four demo account types worked: `owner` (permission bypass, never reads the
role table) and `employee` (name unchanged by the migration). That is exactly why the bug
was invisible on existing machines — a DB seeded *before* the migration got its rows
rewritten to `org_manager` by the migration itself, so the defect only ever reproduced on a
first-time setup.

### 2. `user_roles` was never populated, and HR/Finance had no account

`PermissionSeeder` creates all five system roles per org, but `DatabaseSeeder` inserted
**zero `user_roles` rows** and created no `hr_manager` / `finance_manager` user. The demo
data therefore lived permanently on the backward-compatibility fallback path rather than
the pivot that production accounts use — so the seeded environment did not exercise the
same code path it was meant to represent.

## Fix

[`DatabaseSeeder.php`](../backend/database/seeders/DatabaseSeeder.php) rewritten:

- Demo accounts moved to a `DEMO_USERS` constant, one per system role, with `role` values
  that match `PermissionSeeder`'s names exactly. `admin@acme.com` is removed —
  `manager@acme.com` (`org_manager`) is the same thing under the current matrix.
- Added `hr@acme.com` (`hr_manager`) and `finance@acme.com` (`finance_manager`).
- `assignSystemRoles()` inserts real `user_roles` rows. It **must** run after
  `$this->call(PermissionSeeder::class)`: that seeder deletes and recreates each org's
  system roles on every run, and `user_roles.role_id` is `ON DELETE CASCADE`, so any
  assignment written earlier is silently wiped by it.
- The seeder is now **idempotent** — `firstOrCreate` / `updateOrCreate` keyed on natural
  identifiers, and time-entry generation is skipped when the org already has entries. A
  re-run therefore *repairs* a database seeded with the old role strings instead of failing
  on a unique constraint or piling on another week of sample hours.

Keeping `users.role` correct matters beyond the pivot: it is the fallback, so if someone
runs `db:seed --class=PermissionSeeder` alone (which cascades the assignments away),
permissions still resolve.

## Verification

Fresh `migrate --seed` against a throwaway database, then a real login round-trip against
`POST /api/v1/auth/login`:

| Account | `users.role` | `user_roles` | HTTP | Permissions |
| --- | --- | --- | --- | --- |
| `owner@acme.com` | `owner` | owner | 200 | 75 |
| `manager@acme.com` | `org_manager` | org_manager | 200 | 71 |
| `hr@acme.com` | `hr_manager` | hr_manager | 200 | 51 |
| `finance@acme.com` | `finance_manager` | finance_manager | 200 | 31 |
| `alice@acme.com` | `employee` | employee | 200 | 24 |

Idempotency checked separately: `users.role` was corrupted back to `'admin'`, `db:seed`
re-run, and the role was repaired with no duplication (8 users / 8 assignments /
173 time entries / 3 projects / 8 tasks / 2 teams, unchanged).

## Same drift elsewhere (fixed in the same pass)

The retired names had leaked into three more places. All are now fixed.

### `UserController::update()` rejected every current manager role

The rule was `'role' => 'sometimes|in:owner,admin,manager,employee'`. It **accepted** the
two retired names — writing a value that resolves to no system role, reproducing the exact
empty-permission-map bug through the API — and **rejected** `org_manager`, `hr_manager` and
`finance_manager`, so nobody could be made HR or Finance through the endpoint at all. Custom
org roles were equally unassignable.

Replaced with the pattern `InvitationController` already used: validate the name against the
roles that actually exist in the organization. Two things came out of that:

- `RbacBootstrapService::bootstrapOrg()` is called first (it is idempotent), because an org
  predating the RBAC backfill has no roles rows and would otherwise reject every name.
- An **owner-escalation guard** was added, matching invitations: only an owner may grant the
  `owner` role. Without it `roles.edit` alone was enough to mint another owner. This closed a
  real gap — the old `in:` list happily accepted `owner` from any user holding that
  permission.

`RbacBootstrapService::assignUserToRole()` silently falls back to `employee` when a role name
is not found, so validating existence up front also stops a typo from quietly demoting
someone.

### `RoleController::getUserPriority()` scored current roles as 1

The fallback used when a user has no `user_roles` row was
`match($rawRole) { 'owner' => 100, 'admin' => 50, 'manager' => 30, default => 1 }`. Every
current non-owner role fell through to `default => 1`, and that value feeds the escalation
guard in `assignRole()` (`if ($role->priority >= $userPriority)`). An `org_manager` without a
pivot row was therefore treated as the lowest-privileged user in the system and could assign
no role at all. It now reads the real priority off the org's `roles` table — which also
handles custom roles, whose priorities are data — and falls back to the seeded numbers only
if that lookup misses.

### Frontend role union

`web/src/stores/auth-store.ts` and `web/src/app/(dashboard)/projects/page.tsx` typed `role`
as `'owner' | 'admin' | 'manager' | 'employee'`. Runtime gating is permission-based so
nothing broke, but the union described data that no longer exists. Both now import
`UserRole` from the new [`web/src/lib/roles.ts`](../web/src/lib/roles.ts), which carries the
five system roles plus `(string & {})` — organizations can define custom roles, so the set is
deliberately open. Do not `switch` over it without a default branch.

## Tests

[`backend/tests/Feature/Api/UserRoleUpdateTest.php`](../backend/tests/Feature/Api/UserRoleUpdateTest.php)
— 13 cases covering: each current system role is assignable; the `user_roles` pivot is
synced; retired `admin`/`manager` are rejected; unknown roles are rejected; custom org roles
work; a role belonging to another organization is rejected; a non-owner holding `roles.edit`
is blocked from granting `owner` but can still assign a lesser role; and a non-role update
needs no role. Full backend suite green (753 tests, 2441 assertions).
