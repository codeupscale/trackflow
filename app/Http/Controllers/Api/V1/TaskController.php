<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TaskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Task::query();
        if ($request->has('project_id')) {
            $query->where('project_id', $request->project_id);
        }
        $tasks = $query->where('is_archived', false)->get();
        return response()->json(['tasks' => $tasks]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'required|uuid',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $task = Task::create([
            'organization_id' => $request->user()->organization_id,
            'project_id' => $request->project_id,
            'name' => $request->name,
            'description' => $request->description,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['task' => $task], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $task = Task::findOrFail($id);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'is_archived' => 'sometimes|boolean',
        ]);

        $task->update($request->only(['name', 'description', 'is_archived']));

        return response()->json(['task' => $task->fresh()]);
    }

    public function destroy(string $id): JsonResponse
    {
        $task = Task::findOrFail($id);
        $task->delete();
        return response()->json(['message' => 'Task deleted.']);
    }
}
