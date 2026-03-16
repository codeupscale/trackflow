<?php

namespace App\Services;

use App\Models\Permission;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class PermissionService
{
    public static function userCan(User $user, string $permission): bool
    {
        return Cache::remember(
            "permissions:{$user->id}:{$permission}",
            300,
            function () use ($user, $permission) {
                // Check per-user overrides first
                $override = DB::table('user_permission_overrides')
                    ->join('permissions', 'permissions.id', '=', 'user_permission_overrides.permission_id')
                    ->where('user_permission_overrides.user_id', $user->id)
                    ->where('permissions.name', $permission)
                    ->value('granted');

                if ($override !== null) {
                    return (bool) $override;
                }

                // Fall back to role defaults
                return DB::table('role_permissions')
                    ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
                    ->where('role_permissions.role', $user->role)
                    ->where('permissions.name', $permission)
                    ->exists();
            }
        );
    }

    public static function clearCache(User $user): void
    {
        $permissions = Permission::pluck('name');
        foreach ($permissions as $perm) {
            Cache::forget("permissions:{$user->id}:{$perm}");
        }
    }

    public static function getRolePermissions(string $role): array
    {
        return DB::table('role_permissions')
            ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->where('role_permissions.role', $role)
            ->pluck('permissions.name')
            ->toArray();
    }

    public static function getUserOverrides(User $user): array
    {
        return DB::table('user_permission_overrides')
            ->join('permissions', 'permissions.id', '=', 'user_permission_overrides.permission_id')
            ->where('user_permission_overrides.user_id', $user->id)
            ->select('permissions.name', 'user_permission_overrides.granted')
            ->get()
            ->mapWithKeys(fn ($row) => [$row->name => (bool) $row->granted])
            ->toArray();
    }
}
