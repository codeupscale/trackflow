<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', User::class);

        $users = User::with('teams')
            ->where('organization_id', $request->user()->organization_id)
            ->get();

        return response()->json(['users' => $users]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = $request->user()->organization->users()
            ->with('teams')
            ->findOrFail($id);
        return response()->json(['user' => $user]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user()->organization->users()->findOrFail($id);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'role' => 'sometimes|in:owner,admin,manager,employee',
            'timezone' => 'sometimes|string',
            'is_active' => 'sometimes|boolean',
        ]);

        if ($request->has('role')) {
            $this->authorize('manageRoles', User::class);
        }

        $user->update($request->only(['name', 'role', 'timezone', 'is_active']));
        return response()->json(['user' => $user->fresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $request->user()->organization->users()
            ->findOrFail($id);
        $this->authorize('delete', $user);
        $user->delete();
        return response()->json(['message' => 'User deactivated.']);
    }
}
