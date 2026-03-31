<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;

class UserController extends Controller
{
    private function paginatedResponse(LengthAwarePaginator $paginator): JsonResponse
    {
        return response()->json([
            'data' => $paginator->items(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'total' => $paginator->total(),
                'per_page' => $paginator->perPage(),
            ],
            // Backward-compatible key used by older frontend/tests
            'users' => $paginator->items(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', User::class);

        $perPage = (int) $request->query('per_page', 50);
        $perPage = max(1, min($perPage, 100));

        $query = User::with('teams')
            ->where('organization_id', $request->user()->organization_id);

        // Search by name or email
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', '%' . $search . '%')
                  ->orWhere('email', 'ilike', '%' . $search . '%');
            });
        }

        // Filter by role
        if ($request->filled('role') && $request->input('role') !== 'all') {
            $query->where('role', $request->input('role'));
        }

        // Filter by status (active = last_active within 24h, inactive = older or null)
        if ($request->filled('status') && $request->input('status') !== 'all') {
            if ($request->input('status') === 'active') {
                $query->where('last_active_at', '>=', now()->subHours(24));
            } else {
                $query->where(function ($q) {
                    $q->whereNull('last_active_at')
                      ->orWhere('last_active_at', '<', now()->subHours(24));
                });
            }
        }

        $users = $query->orderBy('name')->paginate($perPage);

        return $this->paginatedResponse($users);
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
