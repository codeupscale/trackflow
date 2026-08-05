<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use App\Services\PermissionService;
use App\Services\RbacBootstrapService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

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

        // Optional filter: restrict to members of one or more projects (project_user pivot).
        // Accepts `project_id` as a single UUID or an array (project_id[]=...).
        if ($request->has('project_id')) {
            $requestedProjectIds = array_values(array_filter(
                (array) $request->input('project_id'),
                static fn ($id) => is_string($id) && $id !== ''
            ));

            Validator::make(
                ['project_id' => $requestedProjectIds],
                ['project_id.*' => ['uuid']],
                [],
                ['project_id.*' => 'project']
            )->validate();

            if ($requestedProjectIds !== []) {
                // Re-resolve against the actor's org so another org's project ids can
                // never surface membership (GlobalOrganizationScope enforces org_id).
                $orgProjectIds = Project::whereIn('id', $requestedProjectIds)
                    ->pluck('id')
                    ->all();

                // whereHas emits an EXISTS subquery, so a user assigned to several of
                // the selected projects is returned exactly once (implicit DISTINCT).
                $query->whereHas('assignedProjects', function ($q) use ($orgProjectIds) {
                    $q->whereIn('projects.id', $orgProjectIds);
                });
            }
        }

        // Search by name or email
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', '%'.$search.'%')
                    ->orWhere('email', 'ilike', '%'.$search.'%');
            });
        }

        // Filter by role — single value (`role=owner`) or array (`role[]=owner&role[]=org_manager`).
        // `role=all` / empty keeps the unfiltered list (existing Team page behavior).
        if ($request->filled('role')) {
            $roles = array_values(array_filter(
                (array) $request->input('role'),
                static fn ($role) => is_string($role) && $role !== '' && $role !== 'all'
            ));

            if ($roles !== []) {
                $query->whereIn('role', $roles);
            }
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
            'role' => 'sometimes|string',
            'timezone' => 'sometimes|string',
            'is_active' => 'sometimes|boolean',
        ]);

        if ($request->has('role')) {
            $this->authorize('manageRoles', User::class);

            // Validate the role against the roles that actually exist in this
            // organization, the same way InvitationController does.
            //
            // This used to be a hardcoded `in:owner,admin,manager,employee` rule, which
            // named two roles that migration 2026_05_13_000004 retired and omitted the
            // three current ones — so org_manager, hr_manager and finance_manager were
            // rejected outright, and a custom role could never be assigned at all.
            //
            // An org predating the RBAC backfill may have no roles rows yet, and the
            // check below would then reject every name; bootstrapOrg() is idempotent.
            app(RbacBootstrapService::class)->bootstrapOrg($user->organization_id);

            $roleModel = Role::where('organization_id', $user->organization_id)
                ->where('name', $request->input('role'))
                ->first();

            if (! $roleModel) {
                return response()->json([
                    'message' => 'The selected role does not exist.',
                    'errors' => ['role' => ['The selected role does not exist in your organization.']],
                ], 422);
            }

            // Only an owner may grant the owner role — same guard as invitations.
            // Without it, `manageRoles` alone would be enough to mint another owner.
            if ($roleModel->name === 'owner' && $request->user()->role !== 'owner') {
                return response()->json([
                    'message' => 'Only owners can assign the owner role.',
                    'errors' => ['role' => ['Only owners can assign the owner role.']],
                ], 403);
            }
        }

        $roleChanged = $request->has('role') && $request->input('role') !== $user->getRawOriginal('role');

        $user->update($request->only(['name', 'role', 'timezone', 'is_active']));

        // When the role changes, update the user_roles pivot to match and invalidate the permission cache
        if ($roleChanged) {
            $newRole = $request->input('role');
            $rbac = app(RbacBootstrapService::class);

            DB::transaction(function () use ($user, $newRole, $rbac) {
                // Remove existing role assignments for this org's system roles
                DB::table('user_roles')
                    ->where('user_id', $user->id)
                    ->delete();

                // Re-assign to the new system role (bootstraps org roles if missing)
                $rbac->bootstrapOrgAndAssignUser($user, $newRole);
            });

            // Bust the permission cache so the next request picks up new permissions immediately
            app(PermissionService::class)->invalidateUser($user->id);
        }

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
