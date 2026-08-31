<?php

namespace App\Services;

use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ShiftService
{
    // ─── Shift CRUD ──────────────────────────────────────────────

    // ─── Team-scoped management ──────────────────────────────────
    //
    // Two tiers, decided by the granted SCOPE of a shifts.* permission:
    //
    //   organization (or 'none', which ranks equal) → owner / org_manager /
    //       hr_manager. Manage every shift, assign anyone in the org.
    //   project ("team" in this codebase)          → a team manager. Create
    //       shifts they OWN, edit/delete only those, and assign only members of
    //       teams they manage.
    //
    // The team tier requires BOTH the permission and an actual managed team, so
    // granting it role-wide cannot hand shift powers to someone who manages
    // nobody — they resolve to an empty audience and are refused.

    /** Does the actor manage every shift in the org (vs. only their own)? */
    public function actorHasOrgScope(User $actor, string $permissionKey): bool
    {
        return app(PermissionService::class)->hasPermission($actor, $permissionKey, 'organization');
    }

    /** Users a team manager may act on: themselves + members of teams they manage. */
    public function managedUserIds(User $actor): array
    {
        return $actor->managedTeams()
            ->with('members:id')
            ->get()
            ->flatMap(fn ($team) => $team->members->pluck('id'))
            ->push($actor->id)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Can this actor edit/delete this shift?
     * Org scope → any shift. Team scope → only shifts they created.
     */
    public function canModifyShift(User $actor, Shift $shift, string $permissionKey): bool
    {
        if ($this->actorHasOrgScope($actor, $permissionKey)) {
            return true;
        }

        if (! app(PermissionService::class)->hasPermission($actor, $permissionKey)) {
            return false;
        }

        // A team manager owns only what they created. Shifts with no creator
        // predate ownership and stay org-managed.
        return $shift->created_by !== null && $shift->created_by === $actor->id;
    }

    /**
     * Guard an assignment target against the actor's audience.
     * Org scope → anyone in the org. Team scope → their managed team only.
     */
    public function assertCanAssignUser(User $actor, string $targetUserId): void
    {
        if ($this->actorHasOrgScope($actor, 'shifts.manage_assignments')) {
            return;
        }

        if (! in_array($targetUserId, $this->managedUserIds($actor), true)) {
            abort(403, 'You can only manage shifts for members of your own team.');
        }
    }

    /**
     * List shifts for an organization, filterable by is_active, searchable by name.
     */
    public function listShifts(string $orgId, array $filters): LengthAwarePaginator
    {
        $query = Shift::with('creator:id,name')->where('organization_id', $orgId);

        if (isset($filters['is_active'])) {
            $query->where('is_active', filter_var($filters['is_active'], FILTER_VALIDATE_BOOLEAN));
        }

        if (! empty($filters['search'])) {
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filters['search']);
            $query->where('name', 'ilike', '%' . $search . '%');
        }

        return $query->orderBy('name')->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Create a new shift.
     */
    public function createShift(string $orgId, array $data, ?User $creator = null): Shift
    {
        return Shift::create(array_merge($data, [
            'organization_id' => $orgId,
            // Stamped so a team manager can later edit/delete their own shift.
            'created_by' => $creator?->id,
        ]));
    }

    /**
     * Update an existing shift.
     */
    public function updateShift(Shift $shift, array $data): Shift
    {
        $shift->update($data);

        return $shift->fresh();
    }

    /**
     * Soft-delete a shift and end all active assignments.
     */
    public function deleteShift(Shift $shift): void
    {
        DB::transaction(function () use ($shift) {
            // End all active assignments: set effective_to = today
            DB::table('user_shifts')
                ->where('shift_id', $shift->id)
                ->where('organization_id', $shift->organization_id)
                ->where(function ($q) {
                    $q->whereNull('effective_to')
                        ->orWhere('effective_to', '>=', now()->toDateString());
                })
                ->whereNull('deleted_at')
                ->update(['effective_to' => now()->toDateString()]);

            $shift->delete();
        });
    }

    /**
     * Get a single shift with its active users.
     */
    public function getShift(string $orgId, string $shiftId): Shift
    {
        return Shift::where('organization_id', $orgId)
            ->with('activeUsers:id,name,email,avatar_url')
            ->findOrFail($shiftId);
    }

    // ─── Assignments ─────────────────────────────────────────────

    /**
     * Assign a user to a shift. Validates no overlapping active assignment.
     */
    public function assignUser(string $orgId, string $userId, string $shiftId, string $effectiveFrom, ?string $effectiveTo, ?User $actor = null): void
    {
        // A team manager may only place their own team members. Passing the
        // actor is what activates the check — internal callers that have already
        // authorised (e.g. the employee form) pass it too.
        if ($actor !== null) {
            $this->assertCanAssignUser($actor, $userId);
        }

        // Validate user belongs to org
        $userExists = DB::table('users')
            ->where('id', $userId)
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->exists();

        if (! $userExists) {
            abort(422, 'User does not belong to this organization.');
        }

        // Check for overlapping active assignment for this user
        $overlap = DB::table('user_shifts')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->where('effective_from', '<=', $effectiveTo ?? '9999-12-31')
            ->where(function ($q) use ($effectiveFrom) {
                $q->whereNull('effective_to')
                    ->orWhere('effective_to', '>=', $effectiveFrom);
            })
            ->exists();

        if ($overlap) {
            abort(422, 'User already has an active shift assignment that overlaps with the specified period.');
        }

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $orgId,
            'user_id' => $userId,
            'shift_id' => $shiftId,
            'effective_from' => $effectiveFrom,
            'effective_to' => $effectiveTo,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Unassign a user from a shift by ending the active pivot row.
     */
    public function unassignUser(string $orgId, string $userId, string $shiftId, ?User $actor = null): void
    {
        if ($actor !== null) {
            $this->assertCanAssignUser($actor, $userId);
        }

        $updated = DB::table('user_shifts')
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('shift_id', $shiftId)
            ->whereNull('deleted_at')
            ->where(function ($q) {
                $q->whereNull('effective_to')
                    ->orWhere('effective_to', '>=', now()->toDateString());
            })
            ->update(['effective_to' => now()->toDateString()]);

        if ($updated === 0) {
            abort(422, 'No active assignment found for this user on this shift.');
        }
    }

    /**
     * Bulk-assign multiple users to a shift. Returns count of successful assignments.
     */
    public function bulkAssign(string $orgId, string $shiftId, array $userIds, string $effectiveFrom, ?string $effectiveTo, ?User $actor = null): int
    {
        return DB::transaction(function () use ($orgId, $shiftId, $userIds, $effectiveFrom, $effectiveTo, $actor) {
            $count = 0;
            foreach ($userIds as $userId) {
                $this->assignUser($orgId, $userId, $shiftId, $effectiveFrom, $effectiveTo, $actor);
                $count++;
            }

            return $count;
        });
    }

    /**
     * Paginate users assigned to a shift with pivot data.
     */
    public function getShiftAssignments(string $orgId, string $shiftId): LengthAwarePaginator
    {
        $shift = Shift::where('organization_id', $orgId)->findOrFail($shiftId);

        return $shift->activeUsers()
            ->select('users.id', 'users.name', 'users.email', 'users.avatar_url')
            ->paginate(25);
    }

    /**
     * Point a user at a (possibly different) shift, as one operation — the
     * employee-form entry point. Assignment history is preserved: the current
     * row is ENDED, never rewritten, so past attendance keeps being judged
     * against the shift that was active then.
     *
     *   - same shift as today → no-op
     *   - null / different    → the current row is ended at YESTERDAY so the
     *                           change takes effect TODAY (a clear that still
     *                           shows the old shift until tomorrow reads as a
     *                           failed clear). A row that only started today is
     *                           retracted (soft-deleted) instead — ending it
     *                           before it began would leave a negative window.
     */
    public function changeUserShift(string $orgId, string $userId, ?string $newShiftId, ?User $actor = null): void
    {
        if ($actor !== null) {
            $this->assertCanAssignUser($actor, $userId);
        }

        DB::transaction(function () use ($orgId, $userId, $newShiftId) {
            $today = now()->toDateString();

            $current = DB::table('user_shifts')
                ->where('organization_id', $orgId)
                ->where('user_id', $userId)
                ->whereNull('deleted_at')
                ->where('effective_from', '<=', $today)
                ->where(function ($q) use ($today) {
                    $q->whereNull('effective_to')
                        ->orWhere('effective_to', '>=', $today);
                })
                ->orderByDesc('effective_from')
                ->first();

            if ($current && $current->shift_id === $newShiftId) {
                return;
            }

            if ($current) {
                $startedToday = Carbon::parse($current->effective_from)->toDateString() === $today;

                if ($startedToday) {
                    DB::table('user_shifts')->where('id', $current->id)
                        ->update(['deleted_at' => now(), 'updated_at' => now()]);
                } else {
                    DB::table('user_shifts')->where('id', $current->id)
                        ->update([
                            'effective_to' => Carbon::parse($today)->subDay()->toDateString(),
                            'updated_at' => now(),
                        ]);
                }
            }

            if ($newShiftId !== null) {
                // assignUser re-validates org membership and overlap (e.g. a
                // future-dated assignment someone scheduled) — a clash 422s here.
                $this->assignUser($orgId, $userId, $newShiftId, $today, null);
            }
        });
    }

    /**
     * Get the current (or date-specific) shift for a user.
     */
    public function getUserCurrentShift(string $orgId, string $userId, ?string $date = null): ?Shift
    {
        $targetDate = $date ?? now()->toDateString();

        return Shift::where('organization_id', $orgId)
            ->whereHas('users', function ($q) use ($userId, $targetDate) {
                $q->where('users.id', $userId)
                    ->where('user_shifts.effective_from', '<=', $targetDate)
                    ->where(function ($sq) use ($targetDate) {
                        $sq->whereNull('user_shifts.effective_to')
                            ->orWhere('user_shifts.effective_to', '>=', $targetDate);
                    });
            })
            ->first();
    }

}
