<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = $user->organization->projects()
            ->with(['tasks', 'manager:id,name,email'])
            ->withCount('members');

        // Search
        if ($search = $request->input('search')) {
            $query->where('name', 'ilike', '%' . $search . '%');
        }

        // Archive filter (default: hide archived)
        if ($request->input('include_archived')) {
            // show all
        } else {
            $query->where('is_archived', false);
        }

        // Employees see only projects they are assigned to (unless org setting allows "see all").
        if ($user->isEmployee() && ! $user->organization->getSetting('employees_see_all_projects', false)) {
            $query->whereHas('members', fn ($q) => $q->where('user_id', $user->id));
        }

        $query->orderBy('name');

        $perPage = min((int) $request->input('per_page', 12), 100);
        $projects = $query->paginate($perPage);

        return response()->json($projects);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', Project::class);

        $request->validate([
            'name' => 'required|string|max:255',
            'color' => ['sometimes', 'string', 'max:7', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'billable' => 'sometimes|boolean',
            'hourly_rate' => 'nullable|numeric|min:0',
            'manager_id' => 'nullable|uuid|exists:users,id',
            'member_ids' => 'sometimes|array',
            'member_ids.*' => 'uuid|exists:users,id',
        ]);

        // Validate manager belongs to the same organization
        if ($request->manager_id) {
            $request->user()->organization->users()->findOrFail($request->manager_id);
        }

        $project = Project::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $request->name,
            'color' => $request->color ?? '#3B82F6',
            'billable' => $request->billable ?? false,
            'hourly_rate' => $request->hourly_rate,
            'created_by' => $request->user()->id,
            'manager_id' => $request->manager_id,
        ]);

        if ($request->has('member_ids')) {
            $orgUserIds = $request->user()->organization->users()
                ->whereIn('id', $request->input('member_ids', []))
                ->pluck('id')
                ->toArray();
            $project->members()->sync($orgUserIds);
        }

        return response()->json(['project' => $project->load('manager:id,name,email')], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $project = Project::where('organization_id', $request->user()->organization_id)
            ->with(['tasks', 'manager:id,name,email'])
            ->withSum('timeEntries as total_duration_seconds', 'duration_seconds')
            ->findOrFail($id);
        $this->authorize('view', $project);
        return response()->json(['project' => $project]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $project = Project::findOrFail($id);
        $this->authorize('update', $project);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'color' => ['sometimes', 'string', 'max:7', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'billable' => 'sometimes|boolean',
            'hourly_rate' => 'nullable|numeric|min:0',
            'is_archived' => 'sometimes|boolean',
            'manager_id' => 'nullable|uuid|exists:users,id',
            'member_ids' => 'sometimes|array',
            'member_ids.*' => 'uuid|exists:users,id',
        ]);

        // Validate manager belongs to the same organization
        if ($request->has('manager_id') && $request->manager_id) {
            $request->user()->organization->users()->findOrFail($request->manager_id);
        }

        $project->update($request->only(['name', 'color', 'billable', 'hourly_rate', 'is_archived', 'manager_id']));

        if ($request->has('member_ids')) {
            $orgUserIds = $request->user()->organization->users()
                ->whereIn('id', $request->input('member_ids', []))
                ->pluck('id')
                ->toArray();
            $project->members()->sync($orgUserIds);
        }

        return response()->json(['project' => $project->fresh()->load('manager:id,name,email')]);
    }

    public function destroy(string $id): JsonResponse
    {
        $project = Project::findOrFail($id);
        $this->authorize('delete', $project);
        $project->delete();

        return response()->json(['message' => 'Project deleted.']);
    }

    /**
     * List members assigned to the project (owner/admin/manager only).
     */
    public function members(Request $request, Project $project): JsonResponse
    {
        $this->authorize('update', $project);

        $members = $project->members()
            ->select('users.id', 'users.name', 'users.email', 'users.role', 'users.avatar_url')
            ->get();

        return response()->json(['members' => $members]);
    }

    /**
     * Assign team members to the project (owner/admin/manager only).
     * Body: { "user_ids": ["uuid", ...] } — syncs the member list (replaces existing).
     */
    public function syncMembers(Request $request, Project $project): JsonResponse
    {
        $this->authorize('update', $project);

        $request->validate([
            'user_ids' => 'required|array',
            'user_ids.*' => 'uuid|exists:users,id',
        ]);

        $userIds = $request->input('user_ids', []);
        // Ensure all users belong to the same organization
        $orgUserIds = $request->user()->organization->users()->whereIn('id', $userIds)->pluck('id')->toArray();
        $project->members()->sync($orgUserIds);

        $members = $project->members()
            ->select('users.id', 'users.name', 'users.email', 'users.role')
            ->get();

        return response()->json(['members' => $members]);
    }

    /**
     * Remove a single member from the project (owner/admin/manager only).
     */
    public function removeMember(Request $request, Project $project, string $user): JsonResponse
    {
        $this->authorize('update', $project);

        $request->user()->organization->users()->findOrFail($user);
        $project->members()->detach($user);

        return response()->json(['message' => 'Member removed from project.']);
    }
}
