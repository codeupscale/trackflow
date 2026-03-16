<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimeEntryController extends Controller
{
    // TIME-08: List entries
    public function index(Request $request): JsonResponse
    {
        $query = TimeEntry::query()
            ->where('organization_id', $request->user()->organization_id)
            ->with(['project', 'task', 'user']);

        // Employees see only own entries
        if ($request->user()->isEmployee()) {
            $query->where('user_id', $request->user()->id);
        } elseif ($request->has('user_id')) {
            $request->user()->organization->users()->findOrFail($request->user_id);
            $query->where('user_id', $request->user_id);
        }

        if ($request->has('project_id')) {
            $query->where('project_id', $request->project_id);
        }
        if ($request->has('date_from')) {
            $query->where('started_at', '>=', $request->date_from);
        }
        if ($request->has('date_to')) {
            $query->where('started_at', '<=', $request->date_to);
        }
        if ($request->has('type')) {
            $query->where('type', $request->type);
        }
        if ($request->has('is_approved')) {
            $query->where('is_approved', filter_var($request->is_approved, FILTER_VALIDATE_BOOLEAN));
        }

        $entries = $query->orderBy('started_at', 'desc')->paginate(
            min((int) $request->input('per_page', 25), 100)
        );

        return response()->json($entries);
    }

    // TIME-06: Show single entry
    public function show(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->with(['project', 'task', 'user'])
            ->findOrFail($id);

        $this->authorize('view', $entry);

        return response()->json(['entry' => $entry]);
    }

    // TIME-05: Create manual entry
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'started_at' => 'required|date|before_or_equal:now',
            'ended_at' => 'required|date|after:started_at',
            'project_id' => 'nullable|uuid',
            'task_id' => 'nullable|uuid',
            'notes' => 'nullable|string|max:1000',
        ]);

        // Check org setting
        $canAddManual = $request->user()->organization->getSetting('can_add_manual_time', true);
        if (!$canAddManual) {
            return response()->json(['message' => 'Manual time entry is disabled for your organization.'], 403);
        }

        // Verify project/task belong to user's organization
        if ($request->project_id) {
            $request->user()->organization->projects()->findOrFail($request->project_id);
        }
        if ($request->task_id) {
            $request->user()->organization->tasks()->findOrFail($request->task_id);
        }

        $startedAt = \Carbon\Carbon::parse($request->started_at);
        $endedAt = \Carbon\Carbon::parse($request->ended_at);

        $entry = TimeEntry::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->id,
            'project_id' => $request->project_id,
            'task_id' => $request->task_id,
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => (int) abs($endedAt->diffInSeconds($startedAt)),
            'type' => 'manual',
            'notes' => $request->notes,
        ]);

        return response()->json(['entry' => $entry->load(['project', 'task'])], 201);
    }

    // TIME-06: Update entry
    public function update(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('update', $entry);

        $request->validate([
            'project_id' => 'nullable|uuid',
            'task_id' => 'nullable|uuid',
            'started_at' => 'sometimes|date',
            'ended_at' => 'nullable|date|after:started_at',
            'notes' => 'nullable|string|max:1000',
        ]);

        if ($request->has('project_id') && $request->project_id) {
            $request->user()->organization->projects()->findOrFail($request->project_id);
        }
        if ($request->has('task_id') && $request->task_id) {
            $request->user()->organization->tasks()->findOrFail($request->task_id);
        }

        $data = $request->only(['project_id', 'task_id', 'started_at', 'ended_at', 'notes']);

        $entry->update($data);

        // Recalculate duration
        if ($entry->started_at && $entry->ended_at) {
            $entry->update([
                'duration_seconds' => (int) abs($entry->ended_at->diffInSeconds($entry->started_at)),
            ]);
        }

        return response()->json(['entry' => $entry->fresh()->load(['project', 'task'])]);
    }

    // TIME-07: Delete entry
    public function destroy(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('delete', $entry);
        $entry->delete();

        return response()->json(['message' => 'Time entry deleted.']);
    }

    // TIME-09: Approve entry
    public function approve(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('approve', $entry);

        $entry->update([
            'is_approved' => true,
            'approved_by' => $request->user()->id,
            'approved_at' => now(),
        ]);

        return response()->json(['entry' => $entry->fresh()]);
    }
}
