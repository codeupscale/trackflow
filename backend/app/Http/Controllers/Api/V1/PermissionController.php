<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Permission;
use Illuminate\Http\JsonResponse;

class PermissionController extends Controller
{
    /**
     * List all available permissions grouped by module.
     */
    public function index(): JsonResponse
    {
        $permissions = Permission::all()
            ->groupBy('module')
            ->map(function ($group) {
                return $group->map(function ($perm) {
                    return [
                        'id' => $perm->id,
                        'key' => $perm->key,
                        'action' => $perm->action,
                        'description' => $perm->description,
                        'has_scope' => $perm->has_scope,
                    ];
                });
            });

        return response()->json([
            'data' => $permissions,
        ]);
    }
}
