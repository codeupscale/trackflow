<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
    public function index(): JsonResponse
    {
        $teams = Team::with(['manager', 'members'])->get();
        return response()->json(['teams' => $teams]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'manager_id' => 'nullable|uuid',
        ]);

        $team = Team::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $request->name,
            'manager_id' => $request->manager_id,
        ]);

        return response()->json(['team' => $team->load('manager')], 201);
    }

    public function show(string $id): JsonResponse
    {
        $team = Team::with(['manager', 'members'])->findOrFail($id);
        return response()->json(['team' => $team]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $team = Team::findOrFail($id);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'manager_id' => 'nullable|uuid',
        ]);

        $team->update($request->only(['name', 'manager_id']));
        return response()->json(['team' => $team->fresh()->load('manager')]);
    }

    public function destroy(string $id): JsonResponse
    {
        $team = Team::findOrFail($id);
        $team->delete();
        return response()->json(['message' => 'Team deleted.']);
    }

    public function addMember(Request $request, string $id): JsonResponse
    {
        $request->validate(['user_id' => 'required|uuid']);
        $team = Team::findOrFail($id);
        $team->members()->syncWithoutDetaching([$request->user_id]);
        return response()->json(['team' => $team->fresh()->load('members')]);
    }

    public function removeMember(Request $request, string $id): JsonResponse
    {
        $request->validate(['user_id' => 'required|uuid']);
        $team = Team::findOrFail($id);
        $team->members()->detach($request->user_id);
        return response()->json(['team' => $team->fresh()->load('members')]);
    }
}
