<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\RejectTimeEntryRequest;
use App\Http\Requests\StoreTimeEntryRequest;
use App\Models\TimeEntry;
use App\Services\ManualTimeEntryService;
use App\Services\ReportService;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimeEntryController extends Controller
{
    public function __construct(private readonly ManualTimeEntryService $manualTimeEntries) {}

    // TIME-08: List entries
    public function index(Request $request): JsonResponse
    {
        $query = TimeEntry::query()
            ->where('organization_id', $request->user()->organization_id)
            ->with(['project', 'task', 'user', 'approver:id,name']);

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
        if ($request->has('date_from') && $request->has('date_to')) {
            $tz = $request->user()->getTimezoneForDates();
            [$dateFromUtc, $dateToUtc] = TimezoneAwareDateRange::toUtcBounds(
                $request->date_from,
                $request->date_to,
                $tz
            );
            $query->where('started_at', '>=', $dateFromUtc)->where('started_at', '<', $dateToUtc);
        }
        if ($request->has('type')) {
            $request->validate(['type' => 'string|in:tracked,manual,idle']);
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
            ->with(['project', 'task', 'user', 'approver:id,name'])
            ->findOrFail($id);

        $this->authorize('view', $entry);

        return response()->json(['entry' => $entry]);
    }

    // TIME-05: Create manual entry (with approval workflow)
    public function store(StoreTimeEntryRequest $request): JsonResponse
    {
        $this->authorize('create', TimeEntry::class);

        $entry = $this->manualTimeEntries->create($request->user(), $request->validated());

        return response()->json([
            'message' => $entry->approval_status === 'pending'
                ? 'Time entry submitted for approval.'
                : 'Time entry created.',
            'entry' => $entry,
        ], 201);
    }

    // TIME-09b: List manual entries pending approval (role-scoped)
    public function pending(Request $request): JsonResponse
    {
        $this->authorize('approve', TimeEntry::class);

        $request->validate([
            'user_id' => 'sometimes|uuid',
            'project_id' => 'sometimes|uuid',
        ]);

        $entries = $this->manualTimeEntries->listPending(
            $request->user(),
            $request->only(['user_id', 'project_id', 'per_page'])
        );

        return response()->json($entries);
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
            'task_name' => 'nullable|string|max:255',
            'started_at' => 'sometimes|date',
            'ended_at' => 'nullable|date|after:started_at',
            'notes' => 'nullable|string|max:1000',
        ]);

        if ($request->has('project_id') && $request->project_id) {
            $project = $request->user()->organization->projects()->findOrFail($request->project_id);
            if (! $project->isAssignedTo($request->user())) {
                return response()->json(['message' => 'You are not assigned to this project.'], 403);
            }
        }
        if ($request->has('task_id') && $request->task_id) {
            $request->user()->organization->tasks()->findOrFail($request->task_id);
        }

        // Auto-create task from free-text name if no task_id provided
        $taskId = $request->task_id;
        if (! $taskId && ! empty($request->task_name)) {
            $projectId = $request->project_id ?? $entry->project_id;
            if ($projectId) {
                $org = $request->user()->organization;
                $task = \App\Models\Task::firstOrCreate(
                    ['organization_id' => $org->id, 'project_id' => $projectId, 'name' => trim($request->task_name)],
                    ['created_by' => $request->user()->id]
                );
                $taskId = $task->id;
            }
        }

        $data = $request->only(['project_id', 'started_at', 'ended_at', 'notes']);
        if ($request->has('task_id') || $request->has('task_name')) {
            $data['task_id'] = $taskId;
        }

        // Check if time fields actually changed before we apply the update.
        $timeChanged = false;
        if ($request->has('started_at') && $entry->started_at->toISOString() !== \Carbon\Carbon::parse($request->started_at)->toISOString()) {
            $timeChanged = true;
        }
        if ($request->has('ended_at') && ($entry->ended_at?->toISOString() ?? null) !== ($request->ended_at ? \Carbon\Carbon::parse($request->ended_at)->toISOString() : null)) {
            $timeChanged = true;
        }

        // Capture pre-edit approval state so we know whether cached report totals
        // (which only include approved entries) need busting after the mutation.
        $wasApproved = $entry->approval_status === 'approved';

        $entry->update($data);

        // Recalculate duration
        if ($entry->started_at && $entry->ended_at) {
            $entry->update([
                'duration_seconds' => (int) abs($entry->ended_at->diffInSeconds($entry->started_at)),
            ]);
        }

        // Only reset approval when TIME fields changed — task/notes edits update
        // immediately without re-approval.
        $approvalReset = false;
        if (
            $timeChanged
            && $entry->type === 'manual'
            && in_array($entry->approval_status, ['approved', 'rejected'], true)
            && $this->manualTimeEntries->mustResetOnEdit($request->user(), $entry)
        ) {
            $entry->update([
                'approval_status' => 'pending',
                'is_approved' => false,
                'approved_by' => null,
                'approved_at' => null,
                'rejection_reason' => null,
            ]);
            $approvalReset = true;
        }

        // Cache staleness (LOW 1): editing a manual entry, or any entry that was
        // approved, may change what an approved report aggregate would return
        // (hours changed, or approval just reset) — bust the org report cache.
        if ($entry->type === 'manual' || $wasApproved) {
            app(ReportService::class)->flushForOrg($entry->organization_id);
        }

        return response()->json([
            'entry' => $entry->fresh()->load(['project', 'task']),
            'approval_reset' => $approvalReset,
        ]);
    }

    // TIME-07: Delete entry
    public function destroy(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('delete', $entry);

        // Capture before delete — a removed approved entry drops out of report
        // aggregates, so its cached totals are now stale (LOW 1).
        $wasApproved = $entry->approval_status === 'approved';
        $isManual = $entry->type === 'manual';
        $orgId = $entry->organization_id;

        $entry->delete();

        if ($isManual || $wasApproved) {
            app(ReportService::class)->flushForOrg($orgId);
        }

        return response()->json(['message' => 'Time entry deleted.']);
    }

    // TIME-09: Approve a pending manual entry
    public function approve(Request $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('approve', $entry);

        // Service owns the self-approval guard + pending precondition + cache bust.
        $approved = $this->manualTimeEntries->approve($request->user(), $entry->id);

        return response()->json([
            'message' => 'Time entry approved.',
            'entry' => $approved,
        ]);
    }

    // TIME-09a: Reject a pending manual entry
    public function reject(RejectTimeEntryRequest $request, string $id): JsonResponse
    {
        $entry = TimeEntry::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('reject', $entry);

        $rejected = $this->manualTimeEntries->reject(
            $request->user(),
            $entry->id,
            $request->validated()['rejection_reason']
        );

        return response()->json([
            'message' => 'Time entry rejected.',
            'entry' => $rejected,
        ]);
    }
}
