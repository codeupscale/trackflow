

# TrackFlow Roles & Permissions System — Comprehensive Product Plan

## Executive Summary

TrackFlow currently operates with four hardcoded roles (owner, admin, manager, employee) enforced through string-matching middleware on the backend and conditional rendering on the frontend. This approach has three structural problems:

1. **No granularity.** A manager sees all team data or nothing. An admin has full access to every module even if they only handle HR. There is no way to create a "Payroll Admin" who can see financial data but not screenshots, or an "HR Manager" who can manage leave but not billing.

2. **No customer configurability.** Every organization has the same permission sets. A 15-person startup wants managers to edit time entries directly; a 5,000-person enterprise wants a four-step approval chain. The current system cannot accommodate either without code changes.

3. **Brittle enforcement.** Permissions checked via `role:owner,admin` strings in middleware and `user?.role === 'admin'` in JSX are scattered across hundreds of files. Adding a new feature requires updating every checkpoint manually. Missing one creates a security hole.

The system designed below replaces this with a **resource-action-scope permission model** stored in normalized PostgreSQL tables, enforced through a single Laravel middleware and policy layer, and delivered to the frontend as a compact permission map on login. It supports the four default roles out of the box (preserving exact current behavior), allows organizations to create unlimited custom roles, and introduces scope qualifiers (own / team / organization) so permissions can be tuned precisely.

The design draws from competitive analysis of Hubstaff, Time Doctor, BambooHR, Keka, and Darwinbox, and is scoped for three implementation phases over approximately 8-10 weeks.

---

## Part 1: Competitive Analysis

### How the competition handles roles and permissions

**Hubstaff**
- Three fixed tiers: Owner, Admin, Manager (per project or team), Member.
- Permissions are tied to the hierarchy: Organizations contain Teams, Teams contain Projects, Members are assigned to Projects.
- Managers can only see data for projects they manage. Admins see everything.
- No custom roles. No per-module permission toggles.
- Screenshot access is all-or-nothing per role tier.
- Limitation: cannot create a "report viewer" role that sees analytics but not screenshots.

**Time Doctor**
- Roles: Owner, Admin, Manager, User.
- Managers have configurable access: can toggle whether managers see screenshots, web/app usage, or only time summaries.
- These toggles are org-wide settings, not per-manager.
- No custom roles.
- Limitation: all managers get the same permissions. Cannot differentiate a "project lead" from a "department head."

**BambooHR**
- Most mature model in the HR space.
- Uses "Access Levels" — essentially custom roles with a permission matrix.
- Each access level defines: which fields on the employee profile are visible/editable, which modules are accessible, and what actions (view/edit/approve) are allowed.
- Supports field-level permissions on employee records (e.g., can see job title but not salary).
- Scope is handled through "Employee Access": own, direct reports, department, or everyone.
- Limitation: complex to configure. Many customers use defaults and never customize.

**Keka**
- Module-based permissions: each module (Leave, Attendance, Payroll, etc.) has its own permission set.
- Roles: Super Admin, Admin, HR Manager, Manager, Employee, plus custom roles.
- Permissions are toggle switches per module per role.
- Supports "data scope" per module: own, team, department, all.
- Clean UI: matrix grid with modules as rows and roles as columns.

**Darwinbox**
- Most granular system. Enterprise-grade RBAC.
- Supports permission "policies" that combine module access, action types, field-level visibility, and data scope.
- Policies can be assigned to roles or directly to users.
- Supports approval workflow configuration per permission set.
- Limitation: over-engineered for SMBs. Configuration takes hours.

### Where TrackFlow should position

TrackFlow's target market spans 10-person startups to 500-person mid-market companies. The system needs to be:
- **Simple by default:** The four existing roles work out of the box with sensible defaults.
- **Configurable when needed:** Organizations can create custom roles and adjust permissions per module.
- **Scope-aware:** "View time entries: own" vs "view time entries: team" vs "view time entries: all" must be first-class concepts.
- **Not field-level:** BambooHR and Darwinbox field-level permissions are over-engineered for our market. We control field visibility at the module/action level, not per-field.

This positions TrackFlow between Time Doctor (too rigid) and Darwinbox (too complex), closest to the Keka model with scope qualifiers borrowed from BambooHR.

---

## Part 2: Permission Taxonomy

### Model: Resource.Action.Scope

Every permission is a triple:

```
{resource}.{action}.{scope}
```

- **Resource**: The module or entity being accessed (e.g., `time_entries`, `screenshots`, `leave_requests`).
- **Action**: What the user is doing (e.g., `view`, `create`, `edit`, `delete`, `approve`, `export`).
- **Scope**: How broadly it applies:
  - `own` — only the user's own data
  - `team` — direct reports (users where the current user is their `manager_id`, or members of projects the user manages)
  - `organization` — all data in the org

Not every combination is valid. A user cannot "approve" their own leave request — that is a business rule enforced at the service layer, not a permission. The permission `leave_requests.approve.team` means the user can approve leave requests from their direct reports.

### Complete Permission Registry

Below is every permission in the system, organized by module. The `Scope Options` column indicates which scopes are meaningful for that permission. Some actions (like creating a department) are inherently org-wide and do not have scope qualifiers.

#### Module 1: Dashboard

| Permission Key | Description | Scope Options |
|---|---|---|
| `dashboard.view_own_stats` | See own time, activity, projects | — (always own) |
| `dashboard.view_team_stats` | See team overview cards and charts | — (team or org based on other perms) |

Dashboard permissions are derived. If a user has `time_entries.view.team`, the dashboard shows team stats. No separate dashboard permissions needed. However, we include two explicit flags because some organizations want a user to see the team dashboard widget without being able to drill into individual time entries.

#### Module 2: Time Entries

| Permission Key | Description | Scope Options |
|---|---|---|
| `time_entries.view` | View time entries | own, team, organization |
| `time_entries.create` | Create manual time entries | own, team, organization |
| `time_entries.edit` | Edit time entries (adjust hours, project) | own, team, organization |
| `time_entries.delete` | Delete time entries | own, team, organization |
| `time_entries.approve` | Approve manual/edited time entries | team, organization |
| `time_entries.export` | Export time data (CSV/PDF) | own, team, organization |

#### Module 3: Screenshots

| Permission Key | Description | Scope Options |
|---|---|---|
| `screenshots.view` | View screenshot captures | own, team, organization |
| `screenshots.delete` | Delete screenshots | own, team, organization |
| `screenshots.manage_settings` | Configure blur, frequency, capture mode | — (org-wide) |

#### Module 4: Projects

| Permission Key | Description | Scope Options |
|---|---|---|
| `projects.view` | View project list and details | own (assigned), organization (all) |
| `projects.create` | Create new projects | — (org-wide) |
| `projects.edit` | Edit project details | own (managed), organization |
| `projects.delete` | Delete / archive projects | own (managed), organization |
| `projects.manage_members` | Add/remove members to projects | own (managed), organization |

#### Module 5: Reports & Analytics

| Permission Key | Description | Scope Options |
|---|---|---|
| `reports.view` | Access reports section | own, team, organization |
| `reports.export` | Export reports as CSV/PDF | own, team, organization |

#### Module 6: Departments

| Permission Key | Description | Scope Options |
|---|---|---|
| `departments.view` | View department list and tree | — (org-wide, all or nothing) |
| `departments.create` | Create new departments | — |
| `departments.edit` | Edit department details | — |
| `departments.delete` | Archive / delete departments | — |

#### Module 7: Positions

| Permission Key | Description | Scope Options |
|---|---|---|
| `positions.view` | View position list | — |
| `positions.create` | Create new positions | — |
| `positions.edit` | Edit position details (including salary bands) | — |
| `positions.delete` | Archive / delete positions | — |
| `positions.view_salary` | View min/max salary (encrypted fields) | — |

#### Module 8: Employees

| Permission Key | Description | Scope Options |
|---|---|---|
| `employees.view_directory` | View employee directory (name, dept, title) | — (org-wide) |
| `employees.view_profile` | View full employee profile | own, team, organization |
| `employees.edit_profile` | Edit employee profile fields | own (personal fields only), organization (all fields) |
| `employees.view_financial` | View bank details, tax ID (encrypted) | own, organization |
| `employees.manage_documents` | Upload, verify, delete employee documents | own, team, organization |
| `employees.manage_notes` | Create, view, delete confidential notes | team, organization |

#### Module 9: Leave Management

| Permission Key | Description | Scope Options |
|---|---|---|
| `leave.apply` | Apply for leave | — (always own) |
| `leave.view_requests` | View leave requests | own, team, organization |
| `leave.approve` | Approve or reject leave requests | team, organization |
| `leave.cancel` | Cancel leave requests | own (own pending only), team, organization |
| `leave.view_calendar` | View leave calendar | team, organization |
| `leave.manage_types` | Create/edit/delete leave types | — (admin) |
| `leave.manage_balances` | Adjust leave balances manually | — (admin) |
| `leave.manage_holidays` | Create/edit/delete public holidays | — (admin) |

#### Module 10: Attendance

| Permission Key | Description | Scope Options |
|---|---|---|
| `attendance.view` | View attendance records | own, team, organization |
| `attendance.generate` | Trigger daily attendance generation | — (admin) |
| `attendance.regularize` | Submit regularization requests | own |
| `attendance.approve_regularizations` | Approve/reject regularizations | team, organization |
| `attendance.manage_overtime_rules` | Configure overtime rules | — (admin) |

#### Module 11: Team Management

| Permission Key | Description | Scope Options |
|---|---|---|
| `team.view_members` | View org member list | — |
| `team.invite` | Invite new members | — |
| `team.remove` | Remove members from org | — |
| `team.change_role` | Change a member's role | — |

#### Module 12: Settings

| Permission Key | Description | Scope Options |
|---|---|---|
| `settings.view_org` | View organization settings | — |
| `settings.edit_org` | Edit org name, timezone, logo | — |
| `settings.edit_tracking` | Edit screenshot interval, idle thresholds | — |
| `settings.manage_billing` | View/edit billing, subscription | — |

#### Module 13: Roles & Permissions

| Permission Key | Description | Scope Options |
|---|---|---|
| `roles.view` | View roles and their permissions | — |
| `roles.create` | Create custom roles | — |
| `roles.edit` | Edit role permissions | — |
| `roles.delete` | Delete custom roles | — |

**Total: 13 modules, 52 distinct permission keys, with scope qualifiers on 20 of them.**

---

## Part 3: Default Role Permission Matrix

These defaults exactly match the current hardcoded behavior so that the migration is invisible to users.

### Notation
- `—` = no access
- `O` = own scope
- `T` = team scope (direct reports / managed projects)
- `A` = organization-wide (all)
- `Y` = yes (no scope qualifier, action is inherently org-wide)

### Time Tracking Permissions

| Permission | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| `dashboard.view_own_stats` | Y | Y | Y | Y |
| `dashboard.view_team_stats` | Y | Y | Y | — |
| `time_entries.view` | A | A | T | O |
| `time_entries.create` | A | A | T | O |
| `time_entries.edit` | A | A | T | O |
| `time_entries.delete` | A | A | T | — |
| `time_entries.approve` | A | A | T | — |
| `time_entries.export` | A | A | T | O |
| `screenshots.view` | A | A | T | O |
| `screenshots.delete` | A | A | — | — |
| `screenshots.manage_settings` | Y | Y | — | — |
| `projects.view` | A | A | A | O |
| `projects.create` | Y | Y | — | — |
| `projects.edit` | A | A | O | — |
| `projects.delete` | A | A | — | — |
| `projects.manage_members` | A | A | O | — |
| `reports.view` | A | A | T | O |
| `reports.export` | A | A | T | O |

### HR Permissions

| Permission | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| `departments.view` | Y | Y | Y | Y |
| `departments.create` | Y | Y | — | — |
| `departments.edit` | Y | Y | — | — |
| `departments.delete` | Y | Y | — | — |
| `positions.view` | Y | Y | Y | Y |
| `positions.create` | Y | Y | — | — |
| `positions.edit` | Y | Y | — | — |
| `positions.delete` | Y | Y | — | — |
| `positions.view_salary` | Y | Y | — | — |
| `employees.view_directory` | Y | Y | Y | Y |
| `employees.view_profile` | A | A | T | O |
| `employees.edit_profile` | A | A | — | O |
| `employees.view_financial` | A | A | — | O |
| `employees.manage_documents` | A | A | T | O |
| `employees.manage_notes` | A | A | T | — |
| `leave.apply` | Y | Y | Y | Y |
| `leave.view_requests` | A | A | T | O |
| `leave.approve` | A | A | T | — |
| `leave.cancel` | A | A | T | O |
| `leave.view_calendar` | A | A | T | T |
| `leave.manage_types` | Y | Y | — | — |
| `leave.manage_balances` | Y | Y | — | — |
| `leave.manage_holidays` | Y | Y | — | — |
| `attendance.view` | A | A | T | O |
| `attendance.generate` | Y | Y | — | — |
| `attendance.regularize` | Y | Y | Y | Y |
| `attendance.approve_regularizations` | A | A | T | — |
| `attendance.manage_overtime_rules` | Y | Y | — | — |

### Administration Permissions

| Permission | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| `team.view_members` | Y | Y | Y | — |
| `team.invite` | Y | Y | — | — |
| `team.remove` | Y | Y | — | — |
| `team.change_role` | Y | Y | — | — |
| `settings.view_org` | Y | Y | — | — |
| `settings.edit_org` | Y | Y | — | — |
| `settings.edit_tracking` | Y | Y | — | — |
| `settings.manage_billing` | Y | — | — | — |
| `roles.view` | Y | Y | — | — |
| `roles.create` | Y | — | — | — |
| `roles.edit` | Y | — | — | — |
| `roles.delete` | Y | — | — | — |

Note: `settings.manage_billing` and `roles.create/edit/delete` are owner-only by default. This is intentional — billing changes and permission escalation are high-risk actions.

---

## Part 4: Database Schema Design

### Approach: Normalized Tables (Not JSON)

JSON columns are tempting for flexibility but are wrong here because:
1. Permissions must be queryable. "Which roles have `leave.approve`?" is a common audit question.
2. Permissions must be indexable for enforcement performance.
3. Schema changes to add new permissions should be migrations, not JSON key additions.
4. PostgreSQL `jsonb` operators make authorization middleware complex and un-type-safe.

### Tables

#### `permissions` — The permission registry

```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,        -- e.g. 'time_entries.view'
    module VARCHAR(50) NOT NULL,             -- e.g. 'time_entries'
    action VARCHAR(30) NOT NULL,             -- e.g. 'view'
    description VARCHAR(255) NOT NULL,       -- Human-readable
    has_scope BOOLEAN NOT NULL DEFAULT false, -- Does this perm support O/T/A qualifiers?
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_permissions_module ON permissions(module);
CREATE INDEX idx_permissions_key ON permissions(key);
```

This table is **not org-scoped**. It is a global registry of all permissions in the system. Seeded by migration.

#### `roles` — Includes both system and custom roles

```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,              -- 'owner', 'admin', 'manager', 'employee', or custom
    display_name VARCHAR(100) NOT NULL,     -- 'Owner', 'HR Manager', etc.
    description VARCHAR(255),
    is_system BOOLEAN NOT NULL DEFAULT false, -- true for the 4 default roles
    is_default BOOLEAN NOT NULL DEFAULT false, -- assigned to new members automatically
    priority SMALLINT NOT NULL DEFAULT 0,    -- higher = more privileged (for escalation checks)
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_roles_org_name UNIQUE (organization_id, name)
);

CREATE INDEX idx_roles_org ON roles(organization_id);
```

**Key design decisions:**
- `is_system = true` for the four default roles. System roles cannot be deleted. Their name cannot be changed. Their permissions can be customized per org (except owner, which always retains full access).
- `is_default = true` marks which role is assigned to newly invited members. Defaults to `employee`.
- `priority` is used for escalation prevention: a user with role priority 50 cannot assign a role with priority 100 to someone else.
- The `owner` role has `priority = 100` and is immutable. No other role can be created with `priority >= 100`.

#### `role_permissions` — The assignment table

```sql
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    scope VARCHAR(15) NOT NULL DEFAULT 'own',  -- 'own', 'team', 'organization'
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_role_perm UNIQUE (role_id, permission_id),
    CONSTRAINT chk_scope CHECK (scope IN ('own', 'team', 'organization', 'none'))
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_id);
```

**How scope works:**
- For permissions where `has_scope = true`, the `scope` column determines the data boundary.
- For permissions where `has_scope = false`, `scope` is ignored (set to `'none'`).
- `organization` scope implies `team`, which implies `own`. They are hierarchical.

#### `user_roles` — Replaces the `role` column on the `users` table

```sql
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
```

**Why a join table instead of a single `role_id` on `users`?**
Future-proofing. A user can hold multiple roles (e.g., "Manager" + "HR Admin"). For phase 1, we enforce a single role per user at the application layer but use the join table so the schema does not need to change when multi-role support is added.

#### No `user_permissions` table (by design)

BambooHR and Darwinbox allow per-user permission overrides. This creates an audit nightmare ("why does this user have access? is it from their role or a direct assignment?"). TrackFlow does not support per-user overrides. All permissions flow through roles. If an organization needs a one-off permission set, they create a custom role.

### Entity Relationship Diagram

```
organizations
    │
    ├──< roles (org_id, is_system, priority)
    │       │
    │       ├──< role_permissions (role_id, permission_id, scope)
    │       │         │
    │       │    permissions (global, not org-scoped)
    │       │
    │       └──< user_roles (user_id, role_id)
    │                 │
    └──< users ───────┘
```

### Migration Strategy from Current System

The current `users` table has a `role` VARCHAR column with values: `owner`, `admin`, `manager`, `employee`.

**Migration steps (single migration, wrapped in a transaction):**

1. Create `permissions`, `roles`, `role_permissions`, `user_roles` tables.
2. Seed the `permissions` table with all 52 permission keys.
3. For each existing organization:
   a. Create 4 system roles (`owner`, `admin`, `manager`, `employee`) with `is_system = true`.
   b. Populate `role_permissions` with the default matrix defined above.
4. For each existing user:
   a. Look up their `role` column value.
   b. Find the matching system role for their `organization_id`.
   c. Insert into `user_roles`.
5. **Do NOT drop the `role` column yet.** Keep it as a read-only denormalized field for one release cycle. The backend reads from `user_roles` but the column remains for rollback safety.
6. Next release: drop the `role` column after confirming no code references it.

```php
// Migration pseudocode
Schema::create('permissions', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->string('key', 100)->unique();
    $table->string('module', 50)->index();
    $table->string('action', 30);
    $table->string('description', 255);
    $table->boolean('has_scope')->default(false);
    $table->timestamp('created_at')->useCurrent();
});

Schema::create('roles', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
    $table->string('name', 50);
    $table->string('display_name', 100);
    $table->string('description', 255)->nullable();
    $table->boolean('is_system')->default(false);
    $table->boolean('is_default')->default(false);
    $table->smallInteger('priority')->default(0);
    $table->timestamps();
    $table->unique(['organization_id', 'name']);
    $table->index('organization_id');
});

Schema::create('role_permissions', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('role_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
    $table->string('scope', 15)->default('own');
    $table->timestamp('created_at')->useCurrent();
    $table->unique(['role_id', 'permission_id']);
    $table->index('role_id');
    $table->index('permission_id');
});

Schema::create('user_roles', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('role_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('assigned_by')->nullable()->constrained('users');
    $table->timestamp('assigned_at')->useCurrent();
    $table->unique(['user_id', 'role_id']);
    $table->index('user_id');
    $table->index('role_id');
});
```

---

## Part 5: Backend Architecture

### Permission Loading and Caching

Permissions are loaded once per request and cached per user session.

```php
// app/Services/PermissionService.php

class PermissionService
{
    /**
     * Returns the full permission map for a user.
     * Cached in Redis for 15 minutes, invalidated on role/permission change.
     *
     * Returns: [
     *   'time_entries.view' => 'organization',
     *   'time_entries.create' => 'own',
     *   'screenshots.manage_settings' => 'none',  // no scope, just has it
     *   ...
     * ]
     */
    public function getPermissionMap(User $user): array
    {
        $cacheKey = "permissions:user:{$user->id}";

        return Cache::remember($cacheKey, 900, function () use ($user) {
            return DB::table('user_roles')
                ->join('role_permissions', 'user_roles.role_id', '=', 'role_permissions.role_id')
                ->join('permissions', 'role_permissions.permission_id', '=', 'permissions.id')
                ->where('user_roles.user_id', $user->id)
                ->pluck('role_permissions.scope', 'permissions.key')
                ->toArray();
        });
    }

    /**
     * Check if user has a specific permission, optionally at a required scope.
     */
    public function hasPermission(User $user, string $permissionKey, ?string $requiredScope = null): bool
    {
        $map = $this->getPermissionMap($user);

        if (!isset($map[$permissionKey])) {
            return false;
        }

        if ($requiredScope === null) {
            return true;  // Has the permission at any scope
        }

        return $this->scopeSatisfies($map[$permissionKey], $requiredScope);
    }

    /**
     * Scope hierarchy: organization > team > own
     */
    private function scopeSatisfies(string $granted, string $required): bool
    {
        $hierarchy = ['own' => 1, 'team' => 2, 'organization' => 3, 'none' => 3];
        return ($hierarchy[$granted] ?? 0) >= ($hierarchy[$required] ?? 0);
    }

    /**
     * Get the granted scope for a permission.
     * Used by services to filter data (e.g., only show own vs team vs all).
     */
    public function getScope(User $user, string $permissionKey): ?string
    {
        $map = $this->getPermissionMap($user);
        return $map[$permissionKey] ?? null;
    }

    /**
     * Invalidate cache when role assignments or permissions change.
     */
    public function invalidateUser(string $userId): void
    {
        Cache::forget("permissions:user:{$userId}");
    }

    public function invalidateRole(string $roleId): void
    {
        $userIds = DB::table('user_roles')
            ->where('role_id', $roleId)
            ->pluck('user_id');

        foreach ($userIds as $userId) {
            $this->invalidateUser($userId);
        }
    }
}
```

### Middleware: `CheckPermission`

Replaces the current `role:owner,admin` middleware with `permission:time_entries.view,team`.

```php
// app/Http/Middleware/CheckPermission.php

class CheckPermission
{
    public function __construct(private PermissionService $permissions) {}

    /**
     * Usage in routes:
     *   ->middleware('permission:time_entries.view')           // any scope
     *   ->middleware('permission:time_entries.view,team')      // team scope or higher
     *   ->middleware('permission:time_entries.view,organization') // org scope only
     */
    public function handle(Request $request, Closure $next, string $permission, ?string $scope = null): Response
    {
        $user = $request->user();

        if (!$user) {
            abort(401);
        }

        if (!$this->permissions->hasPermission($user, $permission, $scope)) {
            abort(403, "You do not have the '{$permission}' permission.");
        }

        return $next($request);
    }
}
```

### Scope-Aware Data Filtering in Services

The scope qualifier is not just a gate check — it controls what data is returned. Here is how existing services adapt.

```php
// Example: TimerService or TimeEntryService

class TimeEntryService
{
    public function __construct(private PermissionService $permissions) {}

    public function listTimeEntries(User $user, array $filters): LengthAwarePaginator
    {
        $scope = $this->permissions->getScope($user, 'time_entries.view');

        if (!$scope) {
            abort(403);
        }

        $query = TimeEntry::query();

        switch ($scope) {
            case 'own':
                $query->where('user_id', $user->id);
                break;
            case 'team':
                $teamUserIds = $this->getTeamUserIds($user);
                $query->whereIn('user_id', $teamUserIds);
                break;
            case 'organization':
                // GlobalOrganizationScope handles org filtering already
                break;
        }

        // Apply additional filters...
        return $query->paginate();
    }

    private function getTeamUserIds(User $manager): array
    {
        // Users where manager_id = this user
        // + members of projects where this user is the project manager
        return User::where('manager_id', $manager->id)
            ->pluck('id')
            ->merge(
                ProjectMember::whereIn('project_id',
                    Project::where('manager_id', $manager->id)->pluck('id')
                )->pluck('user_id')
            )
            ->push($manager->id) // include own data
            ->unique()
            ->values()
            ->toArray();
    }
}
```

This pattern — `getScope()` then `switch` — replaces every current `if ($user->role === 'admin')` check. It is the single most important refactor.

### Route Registration

```php
// routes/api.php — example transformation

// BEFORE (current):
Route::middleware(['auth:sanctum', 'role:owner,admin'])->group(function () {
    Route::get('/settings', [SettingsController::class, 'index']);
});

// AFTER:
Route::middleware(['auth:sanctum', 'permission:settings.view_org'])->group(function () {
    Route::get('/settings', [SettingsController::class, 'index']);
});

// HR routes example:
Route::prefix('hr')->middleware('auth:sanctum')->group(function () {
    Route::get('/leave-requests', [LeaveRequestController::class, 'index'])
        ->middleware('permission:leave.view_requests');
    // Scope handled inside LeaveService, not middleware

    Route::put('/leave-requests/{id}/approve', [LeaveRequestController::class, 'approve'])
        ->middleware('permission:leave.approve,team');

    Route::post('/leave-types', [LeaveTypeController::class, 'store'])
        ->middleware('permission:leave.manage_types');
});
```

### API Endpoints for Roles & Permissions Management

All under `/api/v1/`, Sanctum required.

#### Roles

| Method | Endpoint | Permission Required | Description |
|---|---|---|---|
| `GET` | `/roles` | `roles.view` | List all roles in the org |
| `GET` | `/roles/{id}` | `roles.view` | Get role with its permissions |
| `POST` | `/roles` | `roles.create` | Create a custom role |
| `PUT` | `/roles/{id}` | `roles.edit` | Update role details and permissions |
| `DELETE` | `/roles/{id}` | `roles.delete` | Delete custom role (not system roles) |
| `GET` | `/permissions` | `roles.view` | List all available permissions (global registry) |

#### Role Assignment

| Method | Endpoint | Permission Required | Description |
|---|---|---|---|
| `PUT` | `/users/{id}/role` | `team.change_role` | Assign role to user |

#### Request/Response Formats

**`GET /roles`**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "manager",
      "display_name": "Manager",
      "description": "Team leads who manage direct reports",
      "is_system": true,
      "is_default": false,
      "priority": 50,
      "user_count": 12,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "meta": { "current_page": 1, "last_page": 1, "total": 5 }
}
```

**`GET /roles/{id}`** — includes permissions
```json
{
  "data": {
    "id": "uuid",
    "name": "manager",
    "display_name": "Manager",
    "is_system": true,
    "permissions": {
      "time_entries": {
        "view": "team",
        "create": "team",
        "edit": "team",
        "delete": "team",
        "approve": "team",
        "export": "team"
      },
      "screenshots": {
        "view": "team",
        "delete": null,
        "manage_settings": null
      },
      "leave": {
        "apply": true,
        "view_requests": "team",
        "approve": "team",
        "cancel": "team",
        "view_calendar": "team",
        "manage_types": null,
        "manage_balances": null,
        "manage_holidays": null
      }
    }
  }
}
```

The permissions are returned grouped by module, with the scope as the value. `null` means not granted. `true` means granted without scope (for non-scoped permissions). This format is designed for the frontend matrix UI — modules are rows, actions are columns.

**`POST /roles`**
```json
{
  "display_name": "HR Manager",
  "description": "Can manage all HR modules but not time tracking admin",
  "permissions": {
    "leave.view_requests": "organization",
    "leave.approve": "organization",
    "leave.manage_types": "none",
    "leave.manage_balances": "none",
    "leave.manage_holidays": "none",
    "employees.view_profile": "organization",
    "employees.edit_profile": "organization",
    "employees.view_financial": "organization",
    "attendance.view": "organization",
    "attendance.approve_regularizations": "organization",
    "departments.view": "none",
    "departments.create": "none",
    "departments.edit": "none",
    "positions.view": "none",
    "positions.create": "none",
    "positions.edit": "none",
    "positions.view_salary": "none"
  }
}
```

**`PUT /roles/{id}`** — same body as POST, partial update supported.

**Business rules enforced on role mutations:**
1. Cannot delete a system role.
2. Cannot edit the `owner` role's permissions (owner always has full access, enforced at the service layer, not stored in `role_permissions`).
3. Cannot create a role with priority >= the current user's role priority (escalation prevention).
4. Cannot assign permissions the current user does not themselves have (escalation prevention).
5. Deleting a role requires reassigning all users on that role first. The API returns `409 Conflict` with user count if users are still assigned.

### Passing Permissions to Frontend

The permission map is included in the auth response so the frontend does not need a separate API call.

```json
// POST /auth/login response (updated)
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": {
        "id": "uuid",
        "name": "manager",
        "display_name": "Manager"
      },
      "permissions": {
        "time_entries.view": "team",
        "time_entries.create": "team",
        "time_entries.edit": "team",
        "screenshots.view": "team",
        "leave.apply": "none",
        "leave.view_requests": "team",
        "leave.approve": "team"
      }
    },
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

The permissions map is a flat key-value object: permission key to scope string. This is compact (typically under 2KB for the full map) and trivial to look up on the frontend.

When permissions change (role reassignment, role permission edit), the backend invalidates the Redis cache. The frontend picks up changes on next token refresh (which happens every 24 hours at minimum, or immediately on a 403 response that triggers re-auth).

---

## Part 6: Frontend Architecture

### Permission Store (Zustand)

```typescript
// web/src/stores/permission-store.ts

interface PermissionState {
  permissions: Record<string, string>;  // e.g. { 'time_entries.view': 'team' }
  setPermissions: (perms: Record<string, string>) => void;
  clearPermissions: () => void;

  // Check methods
  hasPermission: (key: string) => boolean;
  hasPermissionWithScope: (key: string, requiredScope: string) => boolean;
  getScope: (key: string) => string | null;
  canAccessModule: (module: string) => boolean;
}

const SCOPE_HIERARCHY: Record<string, number> = {
  own: 1,
  team: 2,
  organization: 3,
  none: 3, // non-scoped permissions
};

export const usePermissionStore = create<PermissionState>((set, get) => ({
  permissions: {},

  setPermissions: (perms) => set({ permissions: perms }),
  clearPermissions: () => set({ permissions: {} }),

  hasPermission: (key) => {
    return key in get().permissions;
  },

  hasPermissionWithScope: (key, requiredScope) => {
    const granted = get().permissions[key];
    if (!granted) return false;
    return (SCOPE_HIERARCHY[granted] ?? 0) >= (SCOPE_HIERARCHY[requiredScope] ?? 0);
  },

  getScope: (key) => {
    return get().permissions[key] ?? null;
  },

  canAccessModule: (module) => {
    return Object.keys(get().permissions).some((key) => key.startsWith(module + '.'));
  },
}));
```

### Permission-Aware Components

```tsx
// web/src/components/permission-gate.tsx

interface PermissionGateProps {
  permission: string;
  scope?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PermissionGate({ permission, scope, fallback = null, children }: PermissionGateProps) {
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();

  const allowed = scope
    ? hasPermissionWithScope(permission, scope)
    : hasPermission(permission);

  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}

// Usage:
<PermissionGate permission="screenshots.view" scope="team">
  <TeamScreenshotGrid />
</PermissionGate>

<PermissionGate permission="leave.approve">
  <LeaveApprovalCard request={request} />
</PermissionGate>
```

### Dynamic Sidebar Navigation

The sidebar currently hardcodes visibility per role. The new system derives it from permissions.

```typescript
// web/src/config/navigation.ts

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  requiredPermission: string;  // any permission in this module
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigationConfig: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard, requiredPermission: 'dashboard.view_own_stats' },
      { title: 'Time Entries', url: '/time-entries', icon: Clock, requiredPermission: 'time_entries.view' },
      { title: 'Screenshots', url: '/screenshots', icon: Camera, requiredPermission: 'screenshots.view' },
      { title: 'Projects', url: '/projects', icon: FolderKanban, requiredPermission: 'projects.view' },
    ],
  },
  {
    label: 'HR',
    items: [
      { title: 'Employees', url: '/hr/employees', icon: Users, requiredPermission: 'employees.view_directory' },
      { title: 'Departments', url: '/hr/departments', icon: Building2, requiredPermission: 'departments.view' },
      { title: 'Leave', url: '/hr/leave', icon: CalendarOff, requiredPermission: 'leave.view_requests' },
      { title: 'Attendance', url: '/hr/attendance', icon: UserCheck, requiredPermission: 'attendance.view' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { title: 'Reports', url: '/reports', icon: BarChart3, requiredPermission: 'reports.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { title: 'Team', url: '/team', icon: UsersRound, requiredPermission: 'team.view_members' },
      { title: 'Roles & Permissions', url: '/settings/roles', icon: Shield, requiredPermission: 'roles.view' },
      { title: 'Settings', url: '/settings', icon: Settings, requiredPermission: 'settings.view_org' },
    ],
  },
];
```

```tsx
// In the sidebar component:
function SidebarNav() {
  const { hasPermission } = usePermissionStore();

  return (
    <>
      {navigationConfig.map((group) => {
        const visibleItems = group.items.filter((item) =>
          hasPermission(item.requiredPermission)
        );

        if (visibleItems.length === 0) return null;

        return (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
  );
}
```

### Roles & Permissions Settings UI

Located at `/settings/roles` in the dashboard.

**Page layout:**

1. **Roles list (left panel or top section):**
   - Cards for each role: name, description, user count, system badge.
   - "Create Custom Role" button (visible only with `roles.create`).
   - Click a role to see/edit its permissions.

2. **Permission matrix (main content):**
   - Modules listed as collapsible sections (accordion pattern).
   - Within each module, actions listed as rows.
   - For scoped permissions, a dropdown selector: None / Own / Team / Organization.
   - For non-scoped permissions, a simple toggle switch.
   - System roles show a lock icon — owner role permissions are read-only.

**Visual wireframe description:**

```
┌──────────────────────────────────────────────────────────────┐
│  Roles & Permissions                              [+ Create] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐│
│  │ Owner   │ │ Admin   │ │ Manager │ │Employee │ │HR Mgr ││
│  │ 1 user  │ │ 3 users │ │ 8 users │ │45 users │ │2 users││
│  │ SYSTEM  │ │ SYSTEM  │ │ SYSTEM  │ │ SYSTEM  │ │CUSTOM ││
│  │         │ │         │ │ [EDIT]  │ │ [EDIT]  │ │[EDIT] ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘│
│                                                              │
│  Editing: Manager                                            │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  ▼ Time Entries                                              │
│  ┌──────────────────────┬────────────────────────┐          │
│  │ Action               │ Access Level           │          │
│  ├──────────────────────┼────────────────────────┤          │
│  │ View time entries    │ [▼ Team            ]   │          │
│  │ Create time entries  │ [▼ Team            ]   │          │
│  │ Edit time entries    │ [▼ Team            ]   │          │
│  │ Delete time entries  │ [▼ Team            ]   │          │
│  │ Approve time entries │ [▼ Team            ]   │          │
│  │ Export time data     │ [▼ Team            ]   │          │
│  └──────────────────────┴────────────────────────┘          │
│                                                              │
│  ▶ Screenshots (collapsed)                                   │
│  ▶ Projects (collapsed)                                      │
│  ▶ Reports (collapsed)                                       │
│                                                              │
│  ▼ Leave Management                                          │
│  ┌──────────────────────┬────────────────────────┐          │
│  │ Action               │ Access Level           │          │
│  ├──────────────────────┼────────────────────────┤          │
│  │ Apply for leave      │ [✓ Enabled         ]   │          │
│  │ View leave requests  │ [▼ Team            ]   │          │
│  │ Approve/reject leave │ [▼ Team            ]   │          │
│  │ Cancel leave         │ [▼ Team            ]   │          │
│  │ View leave calendar  │ [▼ Team            ]   │          │
│  │ Manage leave types   │ [  Disabled        ]   │          │
│  │ Manage balances      │ [  Disabled        ]   │          │
│  │ Manage holidays      │ [  Disabled        ]   │          │
│  └──────────────────────┴────────────────────────┘          │
│                                                              │
│  ▶ Attendance (collapsed)                                    │
│  ▶ Employees (collapsed)                                     │
│  ▶ Administration (collapsed)                                │
│                                                              │
│                                    [Cancel]  [Save Changes]  │
└──────────────────────────────────────────────────────────────┘
```

**Interaction details:**
- Scoped permissions use a select dropdown with options: Disabled, Own, Team, Organization.
- Non-scoped permissions use a toggle: Disabled / Enabled.
- The Owner role card shows "Full Access — All Permissions" and is not editable.
- The Admin role shows an info banner: "System role — changes apply to all admins in your organization."
- Custom roles show a delete button (with confirmation dialog and user-reassignment prompt if users are assigned).
- Changes are batched and submitted on "Save Changes" — not saved per-toggle.

### Role Assignment UI (Team Management Page)

On the existing Team page (`/team`), each member row gains a role dropdown.

```
┌─────────────────────────────────────────────────────────┐
│ Name           │ Email              │ Role        │ ... │
├─────────────────────────────────────────────────────────┤
│ Jane Doe       │ jane@example.com   │ [▼ Manager] │     │
│ John Smith     │ john@example.com   │ [▼ HR Mgr ] │     │
│ Alice Wang     │ alice@example.com  │ [▼ Employee] │     │
└─────────────────────────────────────────────────────────┘
```

The dropdown lists all roles (system + custom). Changing it fires `PUT /users/{id}/role`. Escalation is prevented — a manager cannot assign the owner role.

---

## Part 7: Implementation Phases

### Phase 1: Foundation (Weeks 1-3)

**Goal:** Permission system working end-to-end. All existing behavior preserved. No UI for editing yet.

**Backend:**
1. Create migration for `permissions`, `roles`, `role_permissions`, `user_roles` tables.
2. Create seeder for the 52 permissions and default role matrices.
3. Build `PermissionService` with `getPermissionMap()`, `hasPermission()`, `getScope()`.
4. Build `CheckPermission` middleware.
5. Write data migration to populate roles and user_roles from existing `role` column.
6. Replace all `role:X,Y` middleware references in `routes/api.php` with `permission:X` references.
7. Update all services that check `$user->role` to use `PermissionService::getScope()`.
8. Include permissions in auth response (`/auth/login`, `/auth/me`, `/auth/switch-organization`).

**Frontend:**
9. Create `permission-store.ts` Zustand store.
10. Update `auth-store.ts` to populate permission store on login/token refresh.
11. Create `PermissionGate` component.
12. Refactor sidebar to use `navigationConfig` with `requiredPermission`.
13. Replace all `user?.role === 'X'` checks with `hasPermission()` / `PermissionGate`.

**Testing:**
14. Unit tests for `PermissionService` (scope hierarchy, cache invalidation).
15. Integration tests: verify each default role can access exactly what it could before.
16. Regression tests: confirm no existing API endpoint returns 403 that previously returned 200.

**Key files to modify:**
- `/backend/routes/api.php` — replace all role middleware
- `/backend/app/Http/Kernel.php` — register new middleware alias
- `/backend/app/Services/TimerService.php` — scope-aware filtering
- `/backend/app/Services/LeaveService.php` — already role-scoped, refactor to permission-scoped
- `/backend/app/Services/AttendanceService.php` — same
- `/backend/app/Services/EmployeeService.php` — same
- `/web/src/stores/auth-store.ts` — load permissions
- `/web/src/components/ui/sidebar.tsx` or the layout component that builds nav items
- Every page component with `user?.role` conditionals

### Phase 2: Admin UI (Weeks 4-6)

**Goal:** Owners and admins can view and edit role permissions. Custom roles can be created.

**Backend:**
1. Build `RoleController` (CRUD for roles).
2. Build `PermissionController` (read-only list of all permissions).
3. Business rules: escalation prevention, system role protection, owner immutability.
4. Audit logging: log every permission change with before/after snapshot.

**Frontend:**
5. Build `/settings/roles` page with role cards.
6. Build permission matrix editor (accordion + dropdowns/toggles).
7. Build "Create Custom Role" dialog.
8. Build "Delete Role" flow with user reassignment.
9. Update Team page with role assignment dropdown.

**Testing:**
10. E2E test: create custom role, assign permissions, assign to user, verify access.
11. E2E test: escalation prevention (manager cannot create admin-level role).

### Phase 3: Polish & Advanced (Weeks 7-8)

**Goal:** Audit trail, bulk operations, and edge case handling.

1. Permission change audit log viewer in Settings.
2. "Duplicate Role" action (copy existing role's permissions as starting point for new role).
3. "Compare Roles" side-by-side view.
4. Bulk role assignment (select multiple team members, assign role).
5. Permission dependency warnings (e.g., granting `leave.approve` without `leave.view_requests` is non-functional — show warning in UI).
6. Desktop agent: include permissions in auth token payload so the agent can show/hide features without an extra API call.
7. API rate limit per permission: certain high-privilege endpoints (`roles.edit`, `settings.manage_billing`) get stricter rate limits.

---

## Part 8: Competitive Positioning Summary

| Dimension | Hubstaff | Time Doctor | BambooHR | Keka | TrackFlow (proposed) |
|---|---|---|---|---|---|
| Custom roles | No | No | Yes | Yes | Yes |
| Scope qualifiers (own/team/all) | Implicit via hierarchy | No | Yes (field-level) | Yes (module-level) | Yes (action-level) |
| Per-module permissions | No | Partial (toggles) | Yes | Yes | Yes |
| Escalation prevention | No | No | Yes | Yes | Yes |
| Field-level permissions | No | No | Yes | No | No (intentional — keeps it simple) |
| Custom role creation UI | N/A | N/A | Matrix grid | Toggle grid | Matrix grid with scope dropdowns |
| System role protection | N/A | N/A | Yes | Yes | Yes (owner immutable) |
| Permission audit log | No | No | Yes | No | Yes (Phase 3) |
| Multi-role per user | No | No | No | No | Schema supports, UI enforces single (Phase 1) |
| API-first | No | No | No | No | Yes (full CRUD API for roles) |

**TrackFlow's differentiator:** Scope-aware permissions at the action level (not just module), combined with a clean matrix UI and escalation prevention. This gives mid-market customers the configurability of BambooHR without the complexity of Darwinbox, while covering both time tracking and HR modules in a single permission system — something none of the competitors do because they are either time-tracking-only or HR-only.

---

## Part 9: Technical Safeguards

### Escalation Prevention Rules

1. A user can only assign roles with `priority` strictly less than their own role's priority.
2. A user can only grant permissions they themselves possess. If a manager has `time_entries.view` at `team` scope, they cannot create a custom role with `time_entries.view` at `organization` scope.
3. The `owner` role (`priority = 100`) is the only role that can create/edit/delete roles by default.
4. The `owner` role cannot be deleted, cannot have its permissions edited (always has full access), and at least one user in the org must hold the owner role at all times.

### Cache Invalidation Events

| Event | Invalidation |
|---|---|
| User assigned new role | Invalidate that user's permission cache |
| Role permissions edited | Invalidate all users on that role |
| Role deleted | N/A (users must be reassigned first) |
| User removed from org | Invalidate and delete cache |
| Org switch | Frontend clears and reloads from auth response |

### Frontend Security Note

Frontend permission checks are for UX only — they determine what is shown, not what is allowed. The backend is the authoritative enforcement layer. A user who manipulates the frontend permission store will still be blocked by the `CheckPermission` middleware on every API call. This is why the backend middleware is non-negotiable and must cover every route.

### Backward Compatibility During Migration

During Phase 1 rollout, the system operates in "dual mode":
1. The `role` column on `users` remains populated and in sync.
2. The `user_roles` table is the source of truth for permission checks.
3. Any code that still references `$user->role` continues to work (it returns the name of the user's primary role from `user_roles`).
4. A model accessor on `User` derives `role` from the `user_roles` relationship:

```php
// app/Models/User.php
public function getRoleAttribute(): string
{
    return $this->roles()->orderByDesc('priority')->first()?->name ?? 'employee';
}

public function roles(): BelongsToMany
{
    return $this->belongsToMany(Role::class, 'user_roles')
        ->withPivot('assigned_at');
}
```

This ensures zero breakage during the transition. The old `role` column is dropped only after all references are confirmed removed.

---

## Part 10: Key Files Reference

Files that will be created:

| File | Purpose |
|---|---|
| `/backend/database/migrations/XXXX_create_permissions_tables.php` | Schema for all 4 tables |
| `/backend/database/seeders/PermissionSeeder.php` | Seeds 52 permissions + default role matrices |
| `/backend/app/Services/PermissionService.php` | Core permission checking and caching |
| `/backend/app/Services/RoleService.php` | Role CRUD with escalation prevention |
| `/backend/app/Http/Middleware/CheckPermission.php` | Route-level permission enforcement |
| `/backend/app/Http/Controllers/Api/V1/RoleController.php` | Role management API |
| `/backend/app/Http/Controllers/Api/V1/PermissionController.php` | Permission registry API |
| `/backend/app/Models/Role.php` | Eloquent model |
| `/backend/app/Models/Permission.php` | Eloquent model |
| `/web/src/stores/permission-store.ts` | Zustand permission state |
| `/web/src/components/permission-gate.tsx` | Declarative permission wrapper |
| `/web/src/config/navigation.ts` | Permission-driven nav config |
| `/web/src/app/(dashboard)/settings/roles/page.tsx` | Roles & Permissions UI |
| `/web/src/hooks/use-roles.ts` | TanStack Query hooks for role APIs |

Files that will be modified (heaviest changes):

| File | Change |
|---|---|
| `/backend/routes/api.php` | Replace all `role:X` middleware with `permission:X` |
| `/backend/app/Services/LeaveService.php` | Replace role checks with `PermissionService::getScope()` |
| `/backend/app/Services/AttendanceService.php` | Same |
| `/backend/app/Services/EmployeeService.php` | Same |
| `/backend/app/Services/TimerService.php` | Same |
| `/backend/app/Models/User.php` | Add `roles()` relationship, `getRoleAttribute()` accessor |
| `/web/src/stores/auth-store.ts` | Populate permission store on login |
| `/web/src/app/(dashboard)/layout.tsx` or sidebar component | Permission-driven nav rendering |
| Every page with `user?.role === 'X'` conditionals | Replace with `PermissionGate` or `hasPermission()` |
