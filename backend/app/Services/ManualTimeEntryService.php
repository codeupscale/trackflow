<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * Manual time entry with an approval workflow.
 *
 * A manual entry created by a user whose time_entries.approve scope covers
 * themselves (organization or project scope) is auto-approved. A manual entry
 * created by an employee (own/no approve scope) lands in a 'pending' queue and
 * must be approved by a manager before it counts toward any report or aggregate.
 *
 * Self-approval is prevented on the approve()/reject() paths: the approver may
 * never be the entry's submitter or its owner. (An authorised user's OWN manual
 * entries are auto-approved on creation by design — they never enter the queue.)
 *
 * Multi-tenancy: the target user of an on-behalf entry is always resolved
 * through the actor's own organization, so a cross-tenant user_id can never be
 * attached to an entry.
 */
class ManualTimeEntryService
{
    public function __construct(
        private readonly PermissionService $permissions,
    ) {}

    /**
     * Create a manual time entry.
     *
     * $data: user_id?, project_id?, task_id?, started_at, ended_at, notes?
     */
    public function create(User $actor, array $data): TimeEntry
    {
        $org = $actor->organization;

        // Org-level kill switch — preserved from the previous controller logic.
        if (! $org->getSetting('can_add_manual_time', true)) {
            abort(403, 'Manual time entry is disabled for your organization.');
        }

        $approveScope = $this->permissions->getScope($actor, 'time_entries.approve');
        $coversSelf = in_array($approveScope, ['organization', 'project'], true);

        $requestedUserId = $data['user_id'] ?? null;
        $isSelf = empty($requestedUserId) || $requestedUserId === $actor->id;

        if ($isSelf) {
            $targetUser = $actor;
            // Auto-approve when the actor holds approval authority; otherwise queue.
            $approved = $coversSelf;
        } else {
            // On-behalf entry. The actor must have an approve scope that covers
            // the target, and the target is resolved WITHIN the actor's org so a
            // foreign user_id can never leak in.
            if ($approveScope === 'organization') {
                $targetUser = $org->users()->findOrFail($requestedUserId);
            } elseif ($approveScope === 'project') {
                $targetUser = $org->users()->findOrFail($requestedUserId);
                if (! in_array($targetUser->id, $this->permissions->getProjectUserIds($actor), true)) {
                    abort(403, 'You cannot log time for this user.');
                }
            } else {
                abort(403, 'You cannot log time on behalf of another user.');
            }

            // Time logged on someone's behalf by an authorised user is approved.
            $approved = true;
        }

        // Project / task ownership + assignment checks (preserved from store()).
        if (! empty($data['project_id'])) {
            $project = $org->projects()->findOrFail($data['project_id']);
            if (! $project->isAssignedTo($targetUser)) {
                abort(403, 'The selected user is not assigned to this project.');
            }
        }
        if (! empty($data['task_id'])) {
            $org->tasks()->findOrFail($data['task_id']);
        }

        // Auto-create task from free-text name if no task_id provided
        $taskId = $data['task_id'] ?? null;
        if (! $taskId && ! empty($data['task_name']) && ! empty($data['project_id'])) {
            $task = Task::firstOrCreate(
                ['organization_id' => $org->id, 'project_id' => $data['project_id'], 'name' => trim($data['task_name'])],
                ['created_by' => $actor->id]
            );
            $taskId = $task->id;
        }

        $startedAt = Carbon::parse($data['started_at']);
        $endedAt = Carbon::parse($data['ended_at']);

        return DB::transaction(function () use ($actor, $targetUser, $org, $data, $startedAt, $endedAt, $approved, $taskId) {
            $entry = TimeEntry::create([
                'organization_id' => $org->id,
                'user_id' => $targetUser->id,
                'project_id' => $data['project_id'] ?? null,
                'task_id' => $taskId,
                'started_at' => $startedAt,
                'ended_at' => $endedAt,
                'duration_seconds' => (int) abs($endedAt->diffInSeconds($startedAt)),
                'type' => 'manual',
                'notes' => $data['notes'] ?? null,
                'submitted_by' => $actor->id,
                'approval_status' => $approved ? 'approved' : 'pending',
                'is_approved' => $approved,
                'approved_by' => $approved ? $actor->id : null,
                'approved_at' => $approved ? now() : null,
            ]);

            // Only an approved entry affects report totals — bust the cache then.
            if ($approved) {
                app(ReportService::class)->flushForOrg($org->id);
            }

            return $entry->load(['project', 'task', 'submitter']);
        });
    }

    /**
     * Approve a pending manual entry.
     */
    public function approve(User $actor, string $entryId): TimeEntry
    {
        $entry = TimeEntry::where('organization_id', $actor->organization_id)
            ->findOrFail($entryId);

        $this->assertNotSelfApproval($actor, $entry);
        $this->assertPending($entry);

        return DB::transaction(function () use ($actor, $entry) {
            $entry->update([
                'approval_status' => 'approved',
                'is_approved' => true,
                'approved_by' => $actor->id,
                'approved_at' => now(),
                'rejection_reason' => null,
            ]);

            app(ReportService::class)->flushForOrg($actor->organization_id);

            return $entry->fresh()->load(['project', 'task', 'user', 'submitter', 'approver']);
        });
    }

    /**
     * Reject a pending manual entry with a reason.
     */
    public function reject(User $actor, string $entryId, string $reason): TimeEntry
    {
        $entry = TimeEntry::where('organization_id', $actor->organization_id)
            ->findOrFail($entryId);

        $this->assertNotSelfApproval($actor, $entry);
        $this->assertPending($entry);

        return DB::transaction(function () use ($actor, $entry, $reason) {
            $entry->update([
                'approval_status' => 'rejected',
                'is_approved' => false,
                'approved_by' => $actor->id,
                'approved_at' => now(),
                'rejection_reason' => $reason,
            ]);

            // A rejected entry could previously have been approved+cached; flush.
            app(ReportService::class)->flushForOrg($actor->organization_id);

            return $entry->fresh()->load(['project', 'task', 'user', 'submitter', 'approver']);
        });
    }

    /**
     * Role-scoped, paginated list of pending manual entries awaiting a decision.
     *
     * The route is gated by permission:time_entries.approve, so only users with
     * an approve scope reach here. Row scope is resolved from that scope:
     *   - organization → every pending entry in the org
     *   - project      → pending entries for users in the actor's project scope
     *   - (own/none)    → defensive self-only fallback (unreachable in practice)
     */
    public function listPending(User $actor, array $filters): LengthAwarePaginator
    {
        $scope = $this->permissions->getScope($actor, 'time_entries.approve');

        $query = TimeEntry::where('organization_id', $actor->organization_id)
            ->pending()
            ->with(['user', 'submitter', 'project'])
            ->orderBy('started_at', 'desc');

        if ($scope === 'organization') {
            // Whole org — already constrained by organization_id.
        } elseif ($scope === 'project') {
            $query->whereIn('user_id', $this->permissions->getProjectUserIds($actor));
        } else {
            // Defensive: should be unreachable behind the permission middleware.
            $query->where('user_id', $actor->id);
        }

        if (! empty($filters['user_id'])) {
            $query->where('user_id', $filters['user_id']);
        }
        if (! empty($filters['project_id'])) {
            $query->where('project_id', $filters['project_id']);
        }

        $perPage = min((int) ($filters['per_page'] ?? 25), 100);

        return $query->paginate($perPage);
    }

    /**
     * Can this actor legitimately approve this entry?
     *
     * Mirrors the approve() path exactly: the actor must NOT be the entry's
     * submitter or owner (self-approval guard), AND must hold a
     * time_entries.approve scope that covers the entry's user:
     *   - organization → covers every user in the org (entry is already org-scoped)
     *   - project      → covers only users inside the actor's project scope
     *   - own / none   → cannot approve
     *
     * Used by the update path to decide whether a self-edit of a manual entry
     * must be sent back to the pending queue for re-approval.
     */
    public function canActorApprove(User $actor, TimeEntry $entry): bool
    {
        // Self-approval guard — an actor can never approve their own entry.
        if ($entry->submitted_by === $actor->id || $entry->user_id === $actor->id) {
            return false;
        }

        $scope = $this->permissions->getScope($actor, 'time_entries.approve');

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'project') {
            return in_array($entry->user_id, $this->permissions->getProjectUserIds($actor), true);
        }

        return false;
    }

    /**
     * Must an edited manual entry be sent back to the pending queue?
     *
     * A self-edit that changes the hours must not silently keep a stale
     * 'approved' status — EXCEPT when the editor already holds auto-approve
     * authority over the entry, in which case forcing 'pending' would be
     * inconsistent with create() and, in a single-approver org, would trap the
     * entry with nobody able to clear it. Returns false (keep as-is) when:
     *   - the actor is a legitimate approver of the entry (someone else's), OR
     *   - it is the actor's OWN entry and they hold an organization/project
     *     time_entries.approve scope (exactly the create() auto-approve-self rule).
     * Otherwise (an own-scope employee editing their own entry) returns true.
     */
    public function mustResetOnEdit(User $actor, TimeEntry $entry): bool
    {
        if ($this->canActorApprove($actor, $entry)) {
            return false;
        }

        $isOwn = $entry->submitted_by === $actor->id || $entry->user_id === $actor->id;
        $scope = $this->permissions->getScope($actor, 'time_entries.approve');

        if ($isOwn && in_array($scope, ['organization', 'project'], true)) {
            return false;
        }

        return true;
    }

    /**
     * Reject the decision if the actor is the entry's submitter or owner.
     */
    private function assertNotSelfApproval(User $actor, TimeEntry $entry): void
    {
        if ($entry->submitted_by === $actor->id || $entry->user_id === $actor->id) {
            abort(403, 'You cannot approve your own time entry.');
        }
    }

    /**
     * Only a pending entry can be approved or rejected.
     */
    private function assertPending(TimeEntry $entry): void
    {
        if ($entry->approval_status !== 'pending') {
            abort(422, 'This entry has already been resolved.');
        }
    }
}
