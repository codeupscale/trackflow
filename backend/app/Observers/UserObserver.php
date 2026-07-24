<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    /**
     * Assign a newly-created user to their organization's active "Morning Shift"
     * (the default), if one exists and the user has no active assignment yet.
     *
     * Best-effort: a shift-assignment failure must NEVER break user creation
     * (registration, invitation, and SSO all flow through User::create()). Orgs with no
     * Morning Shift — e.g. the very first owner during org registration, before any
     * shift exists — are simply skipped. Mirrors the backfill migration
     * 2026_07_23_190906_assign_existing_users_to_morning_shift.
     */
    public function created(User $user): void
    {
        try {
            if (empty($user->organization_id)) {
                return;
            }

            $shift = DB::table('shifts')
                ->where('organization_id', $user->organization_id)
                ->whereNull('deleted_at')
                ->where('is_active', true)
                ->whereRaw('LOWER(name) = ?', ['morning shift'])
                ->first(['id']);

            if (! $shift) {
                return;
            }

            $today = now()->toDateString();

            $hasActive = DB::table('user_shifts')
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->whereNull('deleted_at')
                ->where(function ($q) use ($today) {
                    $q->whereNull('effective_to')->orWhere('effective_to', '>=', $today);
                })
                ->exists();

            if ($hasActive) {
                return;
            }

            DB::table('user_shifts')->insert([
                'id' => (string) Str::uuid(),
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'shift_id' => $shift->id,
                'effective_from' => $today,
                'effective_to' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('UserObserver: failed to assign default Morning Shift', [
                'user_id' => $user->id ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
