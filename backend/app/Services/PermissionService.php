<?php

namespace App\Services;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class PermissionService
{
    /**
     * Scope hierarchy: higher value = broader scope.
     * 'none' means the permission is non-scoped (org-wide action like "create department").
     */
    private const SCOPE_HIERARCHY = [
        'own' => 1,
        'team' => 2,
        'organization' => 3,
        'none' => 3,
    ];

    private const CACHE_TTL = 900; // 15 minutes

    /**
     * Get the full permission map for a user.
     *
     * Returns an associative array keyed by permission key with the granted scope as value.
     * Example: ['time_entries.view' => 'organization', 'leave.apply' => 'none', ...]
     *
     * Owner users receive ALL permissions at maximum scope.
     * Cached in Redis for 15 minutes.
     */
    public function getPermissionMap(User $user): array
    {
        $cacheKey = "permissions:user:{$user->id}";

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($user) {
            return $this->buildPermissionMap($user);
        });
    }

    /**
     * Check if a user has a specific permission, optionally requiring a minimum scope.
     *
     * @param string      $permissionKey  e.g. 'time_entries.view'
     * @param string|null $requiredScope  e.g. 'team' — the user must have team or higher scope
     */
    public function hasPermission(User $user, string $permissionKey, ?string $requiredScope = null): bool
    {
        $map = $this->getPermissionMap($user);

        if (! array_key_exists($permissionKey, $map)) {
            return false;
        }

        if ($requiredScope === null) {
            return true;
        }

        return $this->scopeSatisfies($map[$permissionKey], $requiredScope);
    }

    /**
     * Get the granted scope for a permission. Returns null if not granted.
     */
    public function getScope(User $user, string $permissionKey): ?string
    {
        $map = $this->getPermissionMap($user);

        return $map[$permissionKey] ?? null;
    }

    /**
     * Get IDs of users in this user's "team" for scope filtering.
     *
     * Includes:
     * - The user's own ID
     * - Members of projects where this user is the manager
     *
     * @return string[] Array of user UUIDs
     */
    public function getTeamUserIds(User $user): array
    {
        $teamIds = collect([$user->id]);

        // Members of projects where this user is the manager
        $projectMemberIds = DB::table('project_user')
            ->join('projects', 'projects.id', '=', 'project_user.project_id')
            ->where('projects.manager_id', $user->id)
            ->where('projects.organization_id', $user->organization_id)
            ->pluck('project_user.user_id');

        $teamIds = $teamIds->merge($projectMemberIds)->unique()->values()->all();

        return $teamIds;
    }

    /**
     * Invalidate the permission cache for a specific user.
     */
    public function invalidateUser(string $userId): void
    {
        Cache::forget("permissions:user:{$userId}");
    }

    /**
     * Invalidate the permission cache for all users assigned to a role.
     */
    public function invalidateRole(string $roleId): void
    {
        $userIds = DB::table('user_roles')
            ->where('role_id', $roleId)
            ->pluck('user_id');

        foreach ($userIds as $userId) {
            $this->invalidateUser($userId);
        }
    }

    // ── Backward-compatible static methods ────────────────────────────────

    /**
     * @deprecated Use instance method hasPermission() instead.
     */
    public static function userCan(User $user, string $permission): bool
    {
        return app(self::class)->hasPermission($user, $permission);
    }

    /**
     * @deprecated Use instance method getPermissionMap() instead.
     *
     * Accepts role name with optional org ID. Without org ID, returns
     * permissions from the first matching system role (backward compat).
     */
    public static function getRolePermissions(string $role, ?string $orgId = null): array
    {
        $query = Role::where('name', $role)->where('is_system', true);

        if ($orgId !== null) {
            $query->where('organization_id', $orgId);
        }

        $roleModel = $query->first();

        if (! $roleModel) {
            return [];
        }

        return $roleModel->permissions()
            ->get()
            ->mapWithKeys(fn ($perm) => [$perm->key => $perm->pivot->scope])
            ->toArray();
    }

    /**
     * @deprecated User-level permission overrides were removed in the RBAC migration.
     * Returns an empty array for backward compatibility.
     */
    public static function getUserOverrides(User $user): array
    {
        return [];
    }

    /**
     * @deprecated Use instance method invalidateUser() instead.
     *
     * Accepts either a user ID string or a User model for backward compatibility.
     */
    public static function clearCache(string|User $user): void
    {
        $userId = $user instanceof User ? $user->id : $user;
        app(self::class)->invalidateUser($userId);
    }

    // ── Private helpers ───────────────────────────────────────────────────

    /**
     * Build the permission map from the database.
     */
    private function buildPermissionMap(User $user): array
    {
        // Determine the user's highest-priority role
        $primaryRole = DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $user->id)
            ->orderByDesc('roles.priority')
            ->first();

        // Check if the user is an owner (priority >= 100 or role column fallback)
        $isOwner = false;
        if ($primaryRole && $primaryRole->priority >= 100) {
            $isOwner = true;
        } elseif (! $primaryRole && ($user->getRawOriginal('role') ?? 'employee') === 'owner') {
            // Fallback: no user_roles row, check raw column
            $isOwner = true;
        }

        // Owner: return ALL permissions at max scope
        if ($isOwner) {
            return Permission::all()
                ->mapWithKeys(function ($perm) {
                    return [$perm->key => $perm->has_scope ? 'organization' : 'none'];
                })
                ->toArray();
        }

        // Non-owner: JOIN user_roles → role_permissions → permissions
        // If user has multiple roles, take the highest scope per permission.
        $rows = DB::table('user_roles')
            ->join('role_permissions', 'role_permissions.role_id', '=', 'user_roles.role_id')
            ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->where('user_roles.user_id', $user->id)
            ->select('permissions.key', 'role_permissions.scope')
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $existing = $map[$row->key] ?? null;
            if ($existing === null) {
                $map[$row->key] = $row->scope;
            } else {
                // Take the higher scope
                $existingLevel = self::SCOPE_HIERARCHY[$existing] ?? 0;
                $newLevel = self::SCOPE_HIERARCHY[$row->scope] ?? 0;
                if ($newLevel > $existingLevel) {
                    $map[$row->key] = $row->scope;
                }
            }
        }

        // Fallback: if no user_roles rows, use the raw column to find the system role
        if (empty($map) && ! $primaryRole) {
            $rawRole = $user->getRawOriginal('role') ?? 'employee';
            $roleModel = Role::where('organization_id', $user->organization_id)
                ->where('name', $rawRole)
                ->where('is_system', true)
                ->first();

            if ($roleModel) {
                $roleRows = DB::table('role_permissions')
                    ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
                    ->where('role_permissions.role_id', $roleModel->id)
                    ->select('permissions.key', 'role_permissions.scope')
                    ->get();

                foreach ($roleRows as $row) {
                    $map[$row->key] = $row->scope;
                }
            }
        }

        return $map;
    }

    /**
     * Check if a granted scope satisfies a required scope.
     *
     * Hierarchy: own (1) < team (2) < organization (3)
     * 'none' is treated as organization-level (non-scoped permissions).
     */
    private function scopeSatisfies(string $granted, string $required): bool
    {
        $grantedLevel = self::SCOPE_HIERARCHY[$granted] ?? 0;
        $requiredLevel = self::SCOPE_HIERARCHY[$required] ?? 0;

        return $grantedLevel >= $requiredLevel;
    }
}
