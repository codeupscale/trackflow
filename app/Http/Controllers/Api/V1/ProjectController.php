<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(): JsonResponse
    {
        $projects = Project::with('tasks')->where('is_archived', false)->get();
        return response()->json(['projects' => $projects]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', Project::class);

        $request->validate([
            'name' => 'required|string|max:255',
            'color' => 'sometimes|string|max:7',
            'billable' => 'sometimes|boolean',
            'hourly_rate' => 'nullable|numeric|min:0',
        ]);

        $project = Project::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $request->name,
            'color' => $request->color ?? '#3B82F6',
            'billable' => $request->billable ?? false,
            'hourly_rate' => $request->hourly_rate,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['project' => $project], 201);
    }

    public function show(string $id): JsonResponse
    {
        $project = Project::with('tasks')->findOrFail($id);
        $this->authorize('view', $project);
        return response()->json(['project' => $project]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $project = Project::findOrFail($id);
        $this->authorize('update', $project);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'color' => 'sometimes|string|max:7',
            'billable' => 'sometimes|boolean',
            'hourly_rate' => 'nullable|numeric|min:0',
            'is_archived' => 'sometimes|boolean',
        ]);

        $project->update($request->only(['name', 'color', 'billable', 'hourly_rate', 'is_archived']));

        return response()->json(['project' => $project->fresh()]);
    }

    public function destroy(string $id): JsonResponse
    {
        $project = Project::findOrFail($id);
        $this->authorize('delete', $project);
        $project->delete();

        return response()->json(['message' => 'Project deleted.']);
    }
}
