<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $teams = $request->user()->organization->teams()
            ->with(['manager', 'members'])
            ->get();
        return response()->json(['teams' => $teams]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'manager_id' => 'nullable|uuid',
        ]);

        // Verify manager belongs to same organization
        if ($request->manager_id) {
            $request->user()->organization->users()->findOrFail($request->manager_id);
        }

        $team = Team::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $request->name,
            'manager_id' => $request->manager_id,
        ]);

        return response()->json(['team' => $team->load('manager')], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $team = $request->user()->organization->teams()
            ->with(['manager', 'members'])
            ->findOrFail($id);
        return response()->json(['team' => $team]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $team = $request->user()->organization->teams()->findOrFail($id);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'manager_id' => 'nullable|uuid',
        ]);

        if ($request->has('manager_id') && $request->manager_id) {
            $request->user()->organization->users()->findOrFail($request->manager_id);
        }

        $team->update($request->only(['name', 'manager_id']));
        return response()->json(['team' => $team->fresh()->load('manager')]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $team = $request->user()->organization->teams()->findOrFail($id);
        $team->delete();
        return response()->json(['message' => 'Team deleted.']);
    }

    public function addMember(Request $request, string $id): JsonResponse
    {
        $request->validate(['user_id' => 'required|uuid']);
        $team = $request->user()->organization->teams()->findOrFail($id);
        $request->user()->organization->users()->findOrFail($request->user_id);
        $team->members()->syncWithoutDetaching([$request->user_id]);
        return response()->json(['team' => $team->fresh()->load('members')]);
    }

    public function removeMember(Request $request, string $id): JsonResponse
    {
        $request->validate(['user_id' => 'required|uuid']);
        $team = $request->user()->organization->teams()->findOrFail($id);
        $request->user()->organization->users()->findOrFail($request->user_id);
        $team->members()->detach($request->user_id);
        return response()->json(['team' => $team->fresh()->load('members')]);
    }
}
