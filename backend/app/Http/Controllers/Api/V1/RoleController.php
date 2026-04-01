<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RoleController extends Controller
{
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

        return response()->json([
            'data' => [
                'id' => $roleModel->id,
                'name' => $roleModel->name,
                'display_name' => $roleModel->display_name,
                'description' => $roleModel->description,
                'is_system' => $roleModel->is_system,
                'is_default' => $roleModel->is_default,
                'priority' => $roleModel->priority,
                'users_count' => $roleModel->users_count,
                'permissions' => $permissions,
            ],
        ]);
    }
}
