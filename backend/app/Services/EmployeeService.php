<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\EmployeeDocument;
use App\Models\EmployeeNote;
use App\Models\EmployeeProfile;
use App\Models\Scopes\GlobalOrganizationScope;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;

class EmployeeService
{
    /**
     * Paginated employee directory with search and filters.
     * Joins users + employee_profiles + department + position.
     *
     * Role-based scoping (enforced at service layer, not controller):
     * - Employee: sees only their own profile
     * - Manager: sees their own department + managed team members
     * - Admin/Owner: sees all employees in the organization
     */
    public function getDirectory(string $orgId, array $filters, User $viewer): LengthAwarePaginator
    {
        // Archived employees are hidden unless the caller explicitly asks for
        // them (the Archive tab). is_active is the archive flag across the
        // system — see EmployeeService::archive().
        $query = User::where('users.organization_id', $orgId)
            ->where('users.is_active', ! empty($filters['archived']) ? false : true)
            ->leftJoin('employee_profiles', function ($join) {
                $join->on('users.id', '=', 'employee_profiles.user_id')
                    ->on('users.organization_id', '=', 'employee_profiles.organization_id');
            })
            ->leftJoin('departments', 'employee_profiles.department_id', '=', 'departments.id')
            ->leftJoin('positions', 'employee_profiles.position_id', '=', 'positions.id')
            // Active shift assignment for today. The one-active-shift-per-user rule
            // (enforced by ShiftService::assignUser) guarantees at most one matching
            // row, so this join cannot fan out.
            ->leftJoin('user_shifts', function ($join) use ($orgId) {
                $join->on('users.id', '=', 'user_shifts.user_id')
                    ->where('user_shifts.organization_id', $orgId)
                    ->whereNull('user_shifts.deleted_at')
                    ->where('user_shifts.effective_from', '<=', now()->toDateString())
                    ->where(function ($q) {
                        $q->whereNull('user_shifts.effective_to')
                            ->orWhere('user_shifts.effective_to', '>=', now()->toDateString());
                    });
            })
            ->leftJoin('shifts', function ($join) {
                $join->on('user_shifts.shift_id', '=', 'shifts.id')
                    ->whereNull('shifts.deleted_at');
            })
            ->select([
                'users.id',
                'users.name',
                'users.email',
                'users.role',
                'users.avatar_url',
                'users.job_title',
                'users.phone',
                'users.is_active',
                'employee_profiles.employee_id',
                'employee_profiles.employment_status',
                'employee_profiles.employment_type',
                'employee_profiles.date_of_joining',
                'departments.id as department_id',
                'departments.name as department_name',
                'positions.id as position_id',
                'positions.title as position_title',
                'shifts.id as shift_id',
                'shifts.name as shift_name',
                'shifts.color as shift_color',
                'shifts.start_time as shift_start_time',
                'shifts.end_time as shift_end_time',
            ]);

        // Role-based scoping
        if ($viewer->hasRole('owner', 'org_manager', 'hr_manager', 'finance_manager')) {
            // Owner/admin see all employees (no additional filter)
        } elseif ($viewer->isManager()) {
            // Managers see their managed team members + their own department colleagues
            $teamMemberIds = $viewer->managedTeams()
                ->with('members:id')
                ->get()
                ->flatMap(fn ($team) => $team->members->pluck('id'))
                ->push($viewer->id)
                ->unique()
                ->values();

            // Also include users in the same department as the manager
            $viewerProfile = EmployeeProfile::where('user_id', $viewer->id)
                ->where('organization_id', $orgId)
                ->first();

            $query->where(function ($q) use ($teamMemberIds, $viewerProfile) {
                $q->whereIn('users.id', $teamMemberIds);
                if ($viewerProfile && $viewerProfile->department_id) {
                    $q->orWhere('employee_profiles.department_id', $viewerProfile->department_id);
                }
            });
        } else {
            // Employees see only their own profile
            $query->where('users.id', $viewer->id);
        }

        // Search by name, email, or employee_id (escape LIKE wildcards to prevent unexpected matches)
        if (! empty($filters['search'])) {
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filters['search']);
            $query->where(function ($q) use ($search) {
                $q->where('users.name', 'like', "%{$search}%")
                    ->orWhere('users.email', 'like', "%{$search}%")
                    ->orWhere('employee_profiles.employee_id', 'like', "%{$search}%");
            });
        }

        // Filter by department
        if (! empty($filters['department_id'])) {
            $query->where('employee_profiles.department_id', $filters['department_id']);
        }

        // Filter by shift — the practical way to pick out a team, since each
        // team works its own shift. Reads the user_shifts join already made
        // above for the Shift column, which is scoped to the assignment
        // active TODAY, so this returns who is on that shift now rather than
        // anyone who was ever on it.
        if (! empty($filters['shift_id'])) {
            $query->where('user_shifts.shift_id', $filters['shift_id']);
        }

        // Filter by position
        if (! empty($filters['position_id'])) {
            $query->where('employee_profiles.position_id', $filters['position_id']);
        }

        // Filter by employment status
        if (! empty($filters['employment_status'])) {
            $query->where('employee_profiles.employment_status', $filters['employment_status']);
        }

        return $query->orderBy('users.name')->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Full employee profile with relations loaded.
     */
    public function getProfile(string $userId, string $orgId): ?EmployeeProfile
    {
        return EmployeeProfile::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->with(['department', 'position', 'reportingManager', 'user'])
            ->first();
    }

    /**
     * Update employee profile with field-level authorization.
     * Employee can edit personal/emergency/address/financial fields.
     * Admin/Owner can edit all fields including department, position, reporting_manager, employment_status.
     */
    public function updateProfile(string $userId, string $orgId, array $data, User $updater): EmployeeProfile
    {
        return DB::transaction(function () use ($userId, $orgId, $data, $updater) {
            $profile = $this->getOrCreateProfile($userId, $orgId);

            $targetUser = User::where('id', $userId)->where('organization_id', $orgId)->firstOrFail();
            if ($targetUser->hasRole('owner') && ! $updater->hasRole('owner')) {
                abort(403, 'Only an owner can edit the owner\'s profile.');
            }

            // Field-level authorization: employees can only edit personal fields
            $canEditEmploymentFields = app(PermissionService::class)->hasPermission(
                $updater,
                'employees.edit_profile',
                'organization'
            );
            if ($updater->id === $userId && ! $canEditEmploymentFields) {
                $data = array_intersect_key($data, array_flip($this->personalFields()));
            }

            // Shift assignment rides the employee form but is NOT a profile
            // column — it lives in user_shifts and is delegated to ShiftService
            // so both entry points (this form and the Shift Assignment screen)
            // share one set of rules. Distinguish "field absent" from "cleared":
            // only act when the key was actually sent.
            if (array_key_exists('shift_id', $data)) {
                $canManageShifts = app(PermissionService::class)->hasPermission(
                    $updater,
                    'shifts.manage_assignments'
                );
                if (! $canManageShifts) {
                    abort(403, 'You do not have permission to change shift assignments.');
                }
                // Passing the actor activates the team-scope audience check — a
                // team manager can only reshift their own reports.
                app(ShiftService::class)->changeUserShift($orgId, $userId, $data['shift_id'], $updater);
                unset($data['shift_id']);
            }

            // Update user-level fields (name, email, job_title) if provided
            $userFields = array_intersect_key($data, array_flip(['name', 'email', 'job_title']));
            if (! empty($userFields)) {
                if (isset($userFields['email']) && $userFields['email'] !== $targetUser->email) {
                    $exists = User::withoutGlobalScopes()
                        ->where('organization_id', $orgId)
                        ->where('email', $userFields['email'])
                        ->where('id', '!=', $userId)
                        ->exists();
                    if ($exists) {
                        abort(422, 'A user with this email already exists in your organization.');
                    }
                }
                $targetUser->update($userFields);
            }
            $data = array_diff_key($data, array_flip(['name', 'email', 'job_title']));

            $profile->update($data);

            return $profile->fresh()->load(['department', 'position', 'reportingManager', 'user']);
        });
    }

    /**
     * Lazily create employee_profile on first access if it doesn't exist.
     */
    public function getOrCreateProfile(string $userId, string $orgId): EmployeeProfile
    {
        $profile = EmployeeProfile::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->first();

        if ($profile) {
            return $profile;
        }

        $user = User::where('id', $userId)
            ->where('organization_id', $orgId)
            ->firstOrFail();

        return EmployeeProfile::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'employee_id' => $this->generateEmployeeId($orgId),
            'employment_status' => 'active',
            'employment_type' => 'full_time',
            'date_of_joining' => $user->date_of_joining,
        ]);
    }

    /**
     * Auto-generate next employee ID like EMP-001, EMP-002 scoped per org.
     * Uses lockForUpdate to prevent race conditions.
     */
    public function generateEmployeeId(string $orgId): string
    {
        return DB::transaction(function () use ($orgId) {
            $profiles = EmployeeProfile::where('organization_id', $orgId)
                ->whereNotNull('employee_id')
                ->lockForUpdate()
                ->pluck('employee_id');

            $maxNumber = 0;
            foreach ($profiles as $empId) {
                if (preg_match('/(\d+)$/', $empId, $matches)) {
                    $maxNumber = max($maxNumber, (int) $matches[1]);
                }
            }

            return 'EMP-' . str_pad($maxNumber + 1, 3, '0', STR_PAD_LEFT);
        });
    }

    /**
     * Upload a document to S3 and create EmployeeDocument record.
     */
    public function uploadDocument(string $userId, string $orgId, UploadedFile $file, array $data): EmployeeDocument
    {
        $path = $file->store("documents/{$orgId}/{$userId}", 's3');

        return EmployeeDocument::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'title' => $data['title'],
            'category' => $data['category'],
            'file_path' => $path,
            'file_name' => $file->getClientOriginalName(),
            'file_size' => $file->getSize(),
            'mime_type' => $file->getMimeType(),
            'expiry_date' => $data['expiry_date'] ?? null,
            'notes' => $data['notes'] ?? null,
        ]);
    }

    /**
     * Soft delete a document (don't remove from S3).
     */
    public function deleteDocument(EmployeeDocument $document): void
    {
        $document->delete();
    }

    /**
     * Verify a document: set is_verified, verified_by, verified_at.
     */
    public function verifyDocument(EmployeeDocument $document, string $verifierId): EmployeeDocument
    {
        $document->update([
            'is_verified' => true,
            'verified_by' => $verifierId,
            'verified_at' => now(),
        ]);

        return $document->fresh();
    }

    /**
     * Get paginated documents for an employee, filterable by category.
     */
    public function getDocuments(string $userId, string $orgId, array $filters): LengthAwarePaginator
    {
        $query = EmployeeDocument::where('user_id', $userId)
            ->where('organization_id', $orgId);

        if (! empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        return $query->orderBy('created_at', 'desc')
            ->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Get paginated notes for an employee, ordered by created_at desc.
     * Confidential notes are only visible to owner/admin viewers.
     */
    public function getNotes(string $userId, string $orgId, User $viewer): LengthAwarePaginator
    {
        return EmployeeNote::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->when(! $viewer->hasRole('owner', 'org_manager', 'hr_manager'), fn ($q) => $q->where('is_confidential', false))
            ->with('author:id,name,email,avatar_url')
            ->orderBy('created_at', 'desc')
            ->paginate(25);
    }

    /**
     * Create an employee note.
     */
    public function createNote(string $userId, string $orgId, string $authorId, array $data): EmployeeNote
    {
        return EmployeeNote::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'author_id' => $authorId,
            'content' => $data['content'],
            'is_confidential' => $data['is_confidential'] ?? false,
        ]);
    }

    /**
     * Mask a financial field: returns ****1234 (last 4 chars visible).
     */
    public function maskFinancialField(?string $value): ?string
    {
        if ($value === null || strlen($value) === 0) {
            return null;
        }

        $visible = substr($value, -4);

        return '****' . $visible;
    }

    /**
     * Archive employees — the system-wide "this person has left" switch.
     *
     * `users.is_active = false` IS the archive flag; there is deliberately no
     * separate `archived` column. The flag already blocked login and was
     * already filtered by most listing queries, so a fourth concept would have
     * meant four things to keep in sync instead of one.
     *
     * Flipping the flag is not enough on its own. Deactivation never touched
     * existing tokens, so an archived employee's DESKTOP AGENT kept tracking
     * and their browser session kept working until the refresh token expired
     * up to 30 days later. Archiving therefore also revokes every token, closes
     * anything still open in their name, and withdraws work that was awaiting
     * someone else's decision:
     *
     *   - open time entries are closed at their last heartbeat, never at now(),
     *     for the same reason the abandoned-entry backstop does it that way:
     *     closing at now() bills the hours between leaving and being archived.
     *   - an open check-in session is closed and the day's rollups recomputed.
     *   - pending leave requests are cancelled — nobody should be approving
     *     leave for someone who has left.
     *
     * Returns the number of employees actually archived (already-archived ids
     * are skipped, so a repeated call is a no-op rather than an error).
     *
     * @param  array<int,string>  $userIds
     */
    public function archive(string $orgId, array $userIds, User $actor): int
    {
        return DB::transaction(function () use ($orgId, $userIds, $actor) {
            $users = User::where('organization_id', $orgId)
                ->whereIn('id', $userIds)
                ->where('is_active', true)
                ->lockForUpdate()
                ->get();

            // An actor cannot archive themselves: it would revoke the token of
            // the request in flight and lock them out mid-action.
            $users = $users->reject(fn (User $u) => $u->id === $actor->id);

            foreach ($users as $user) {
                $this->closeOpenWorkFor($user);

                $user->forceFill(['is_active' => false])->save();
                $user->tokens()->delete();

                EmployeeProfile::where('organization_id', $orgId)
                    ->where('user_id', $user->id)
                    ->update([
                        'employment_status' => 'terminated',
                        // Only stamp an exit date if HR has not recorded one.
                        'date_of_exit' => DB::raw("COALESCE(date_of_exit, '" . now()->toDateString() . "')"),
                        'updated_at' => now(),
                    ]);
            }

            return $users->count();
        });
    }

    /**
     * Restore archived employees to active.
     *
     * Deliberately NOT the inverse of everything archive() did: the closed time
     * entries, check-in sessions and cancelled leave requests stay closed and
     * cancelled. Those are history, and a rehire does not resume a session from
     * before they left. Restore only makes the person visible and able to sign
     * in again — they get fresh tokens by logging in.
     *
     * @param  array<int,string>  $userIds
     */
    public function restore(string $orgId, array $userIds): int
    {
        return DB::transaction(function () use ($orgId, $userIds) {
            $users = User::where('organization_id', $orgId)
                ->whereIn('id', $userIds)
                ->where('is_active', false)
                ->lockForUpdate()
                ->get();

            foreach ($users as $user) {
                $user->forceFill(['is_active' => true])->save();

                EmployeeProfile::where('organization_id', $orgId)
                    ->where('user_id', $user->id)
                    ->update([
                        'employment_status' => 'active',
                        'date_of_exit' => null,
                        'updated_at' => now(),
                    ]);
            }

            return $users->count();
        });
    }

    /**
     * Close anything still running in an archived employee's name.
     *
     * Open time entries close at their last heartbeat (falling back to their
     * own start), never at now() — the same rule TimeEntrySyncService uses for
     * abandoned entries, and for the same reason: an agent left running on a
     * machine nobody is using must not bill the gap.
     */
    private function closeOpenWorkFor(User $user): void
    {
        $openEntries = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->whereNull('ended_at')
            ->lockForUpdate()
            ->get();

        foreach ($openEntries as $entry) {
            // Same resolution order as TimeEntrySyncService: newest heartbeat,
            // else the agent's last sync, else the entry's own start.
            $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)->max('logged_at');

            $endedAt = $lastHeartbeat
                ? Carbon::parse($lastHeartbeat)
                : ($entry->client_synced_at ?? $entry->started_at);

            if ($endedAt->lt($entry->started_at)) {
                $endedAt = $entry->started_at->copy();
            }

            $entry->update([
                'ended_at' => $endedAt,
                'duration_seconds' => max(0, (int) $entry->started_at->diffInSeconds($endedAt)),
            ]);
        }

        // Redis still holds a pointer to the live entry for the timer widget.
        Redis::del("timer:{$user->id}");

        // Open check-in sessions: close at the same instant and let the
        // check-in service recompute the day's rollups from the session set.
        $openSessions = DB::table('check_in_sessions')
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->whereNull('check_out_at')
            ->whereNull('deleted_at')
            ->pluck('attendance_record_id', 'id');

        if ($openSessions->isNotEmpty()) {
            DB::table('check_in_sessions')
                ->whereIn('id', $openSessions->keys())
                ->update(['check_out_at' => now(), 'updated_at' => now()]);

            app(CheckInService::class)->recomputeRecordsAfterArchive(
                $openSessions->values()->unique()->all()
            );
        }

        // Leave awaiting a decision is withdrawn: nobody approves leave for
        // someone who has left, and a stale request blocks the approvals queue.
        DB::table('leave_requests')
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'pending')
            ->whereNull('deleted_at')
            ->update(['status' => 'cancelled', 'updated_at' => now()]);
    }

    /**
     * Fields that employees can edit on their own profile.
     */
    private function personalFields(): array
    {
        return [
            'blood_group',
            'marital_status',
            'nationality',
            'gender',
            'emergency_contact_name',
            'emergency_contact_phone',
            'emergency_contact_relation',
            'current_address',
            'permanent_address',
            'bank_name',
            'bank_account_number',
            'bank_routing_number',
            'tax_id',
        ];
    }
}
