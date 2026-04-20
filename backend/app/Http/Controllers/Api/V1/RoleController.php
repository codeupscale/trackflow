<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\PermissionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RoleController extends Controller
{
    public function __construct(private readonly PermissionService $permissionService) {}

    /**
     * List all roles in the organization with user count.
     */
    public function index(Request $request): JsonResponse
    {
        $roles = Role::where('organization_id', $request->user()->organization_id)
            ->withCount('users')
            ->orderByDesc('priority')
            ->get();

        return response()->json([
            'data' => $roles,
        ]);
    }

    /**
     * Show a single role with its permissions grouped by module.
     */
    public function show(Request $request, string $role): JsonResponse
    {
        $roleModel = Role::where('organization_id', $request->user()->organization_id)
            ->withCount('users')
            ->findOrFail($role);

        return response()->json([
            'data' => $this->formatRoleWithPermissions($roleModel),
        ]);
    }

    /**
     * Create a custom role.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'display_name' => 'required|string|max:100',
            'description' => 'nullable|string|max:255',
            'permissions' => 'required|array',
            'permissions.*' => 'string|in:own,team,organization,none',
        ]);

        $user = $request->user();
        $userPriority = $this->getUserPriority($user);
        $userPermMap = $this->permissionService->getPermissionMap($user);

        // Escalation prevention: validate requested permissions
        $this->validatePermissionEscalation($validated['permissions'], $userPermMap);

        $role = DB::transaction(function () use ($validated, $user, $userPriority) {
            $name = Str::slug($validated['display_name'], '_');

            // Ensure unique name within the org
            $baseName = $name;
            $counter = 1;
            while (Role::where('organization_id', $user->organization_id)->where('name', $name)->exists()) {
                $name = $baseName . '_' . $counter++;
            }

            // Custom roles always get priority 10 (below manager=30)
            $priority = min(10, $userPriority - 1);

            $role = Role::create([
                'organization_id' => $user->organization_id,
                'name' => $name,
                'display_name' => $validated['display_name'],
                'description' => $validated['description'] ?? null,
                'is_system' => false,
                'is_default' => false,
                'priority' => $priority,
            ]);

            $this->syncPermissions($role, $validated['permissions']);

            return $role;
        });

        $role->loadCount('users');

        return response()->json([
            'data' => $this->formatRoleWithPermissions($role),
        ], 201);
    }

    /**
     * Update a role's permissions (and optionally name/description for custom roles).
     */
    public function update(Request $request, string $role): JsonResponse
    {
        $roleModel = Role::where('organization_id', $request->user()->organization_id)
            ->withCount('users')
            ->findOrFail($role);

        // Cannot edit owner role
        if ($roleModel->priority >= 100) {
            return response()->json([
                'message' => 'The owner role cannot be modified.',
            ], 403);
        }

        $rules = [
            'permissions' => 'required|array',
            'permissions.*' => 'string|in:own,team,organization,none',
        ];

        // Custom roles can also change display_name and description
        if (! $roleModel->is_system) {
            $rules['display_name'] = 'sometimes|string|max:100';
            $rules['description'] = 'nullable|string|max:255';
        }

        $validated = $request->validate($rules);

        $user = $request->user();
        $userPermMap = $this->permissionService->getPermissionMap($user);

        // Escalation prevention: validate requested permissions
        $this->validatePermissionEscalation($validated['permissions'], $userPermMap);

        DB::transaction(function () use ($roleModel, $validated) {
            // Update name/description for custom roles only
            if (! $roleModel->is_system) {
                if (isset($validated['display_name'])) {
                    $roleModel->display_name = $validated['display_name'];
                }
                if (array_key_exists('description', $validated)) {
                    $roleModel->description = $validated['description'];
                }
                $roleModel->save();
            }

            // Replace all permissions
            $roleModel->permissions()->detach();
            $this->syncPermissions($roleModel, $validated['permissions']);
        });

        // Invalidate cached permissions for all users on this role
        $this->permissionService->invalidateRole($roleModel->id);

        $roleModel->refresh();
        $roleModel->loadCount('users');

        return response()->json([
            'data' => $this->formatRoleWithPermissions($roleModel),
        ]);
    }

    /**
     * Delete a custom role.
     */
    public function destroy(Request $request, string $role): JsonResponse
    {
        $roleModel = Role::where('organization_id', $request->user()->organization_id)
            ->withCount('users')
            ->findOrFail($role);

        if ($roleModel->is_system) {
            return response()->json([
                'message' => 'System roles cannot be deleted.',
            ], 403);
        }

        if ($roleModel->users_count > 0) {
            return response()->json([
                'message' => "Cannot delete role: {$roleModel->users_count} user(s) are still assigned to it. Reassign them first.",
                'users_count' => $roleModel->users_count,
            ], 409);
        }

        $roleModel->permissions()->detach();
        $roleModel->delete();

        return response()->json([
            'message' => 'Role deleted successfully.',
        ]);
    }

    /**
     * Assign a role to a user.
     */
    public function assignRole(Request $request, string $userId): JsonResponse
    {
        $validated = $request->validate([
            'role_id' => 'required|uuid',
        ]);

        $user = $request->user();
        $orgId = $user->organization_id;

        // Find the role in the same org
        $role = Role::where('organization_id', $orgId)
            ->findOrFail($validated['role_id']);

        // Escalation prevention: cannot assign role with priority >= own
        $userPriority = $this->getUserPriority($user);
        if ($role->priority >= $userPriority) {
            return response()->json([
                'message' => 'You cannot assign a role with equal or higher priority than your own.',
            ], 403);
        }

        // Find the target user in the same org
        $targetUser = User::where('organization_id', $orgId)
            ->findOrFail($userId);

        // Cannot reassign owners
        $targetPriority = $this->getUserPriority($targetUser);
        if ($targetPriority >= 100) {
            return response()->json([
                'message' => 'Cannot change the role of an owner.',
            ], 403);
        }

        DB::transaction(function () use ($targetUser, $role) {
            // Remove old user_roles
            DB::table('user_roles')
                ->where('user_id', $targetUser->id)
                ->delete();

            // Insert new
            DB::table('user_roles')->insert([
                'id'          => \Illuminate\Support\Str::uuid()->toString(),
                'user_id'     => $targetUser->id,
                'role_id'     => $role->id,
                'assigned_by' => null,
                'assigned_at' => now(),
            ]);

            // Update legacy role column for backward compatibility
            $targetUser->update(['role' => $role->name]);
        });

        // Invalidate cache
        $this->permissionService->invalidateUser($targetUser->id);

        return response()->json([
            'message' => 'Role assigned successfully.',
            'data' => [
                'user_id' => $targetUser->id,
                'role_id' => $role->id,
                'role_name' => $role->name,
                'role_display_name' => $role->display_name,
            ],
        ]);
    }

    // ── Private helpers ───────────────────────────────────────────────────

    /**
     * Get the highest priority of any role assigned to the user.
     */
    private function getUserPriority(User $user): int
    {
        $priority = DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $user->id)
            ->max('roles.priority');

        if ($priority !== null) {
            return (int) $priority;
        }

        // Fallback: use the raw role column
        $rawRole = $user->getRawOriginal('role') ?? 'employee';

        return match ($rawRole) {
            'owner' => 100,
            'admin' => 50,
            'manager' => 30,
            default => 1,
        };
    }

    /**
     * Validate that the requesting user has all permissions they are trying to grant.
     * Throws a 403 if escalation is detected.
     *
     * @param array<string, string> $requestedPermissions  permission_key => scope
     * @param array<string, string> $userPermMap            user's current permission map
     */
    private function validatePermissionEscalation(array $requestedPermissions, array $userPermMap): void
    {
        $scopeHierarchy = ['own' => 1, 'team' => 2, 'organization' => 3, 'none' => 3];

        foreach ($requestedPermissions as $key => $scope) {
            if (! array_key_exists($key, $userPermMap)) {
                abort(403, "Escalation denied: you do not have the '{$key}' permission.");
            }

            $grantedLevel = $scopeHierarchy[$userPermMap[$key]] ?? 0;
            $requestedLevel = $scopeHierarchy[$scope] ?? 0;

            if ($requestedLevel > $grantedLevel) {
                abort(403, "Escalation denied: you cannot grant '{$key}' at scope '{$scope}'.");
            }
        }
    }

    /**
     * Sync permission entries for a role.
     *
     * @param array<string, string> $permissions  permission_key => scope
     */
    private function syncPermissions(Role $role, array $permissions): void
    {
        $permissionKeys = array_keys($permissions);
        $permModels = Permission::whereIn('key', $permissionKeys)->get()->keyBy('key');

        $rows = [];
        foreach ($permissions as $key => $scope) {
            $perm = $permModels->get($key);
            if ($perm) {
                $rows[] = [
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'role_id' => $role->id,
                    'permission_id' => $perm->id,
                    'scope' => $scope,
                    'created_at' => now(),
                ];
            }
        }

        if (! empty($rows)) {
            DB::table('role_permissions')->insert($rows);
        }
    }

    /**
     * Format a role with its permissions grouped by module (used by show, store, update).
     */
    private function formatRoleWithPermissions(Role $roleModel): array
    {
        $permissions = $roleModel->permissions()
            ->get()
            ->groupBy('module')
            ->map(function ($group) {
                return $group->map(function ($perm) {
                    return [
                        'id' => $perm->id,
                        'key' => $perm->key,
                        'action' => $perm->action,
                        'description' => $perm->description,
                        'has_scope' => $perm->has_scope,
                        'scope' => $perm->pivot->scope,
                    ];
                });
            });

        return [
            'id' => $roleModel->id,
            'name' => $roleModel->name,
            'display_name' => $roleModel->display_name,
            'description' => $roleModel->description,
            'is_system' => $roleModel->is_system,
            'is_default' => $roleModel->is_default,
            'priority' => $roleModel->priority,
            'users_count' => $roleModel->users_count,
            'permissions' => $permissions,
        ];
    }
}
