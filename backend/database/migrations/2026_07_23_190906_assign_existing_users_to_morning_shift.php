<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Backfill: assign every existing active user to their organization's "Morning Shift".
 *
 * Matched by shift NAME per organization (not a hardcoded id) so it is portable across
 * environments — each org's Morning Shift has a different UUID. Orgs without an active
 * "Morning Shift" are skipped, and users who already hold an active shift assignment are
 * left untouched (idempotent — safe to re-run). New users are assigned on creation by
 * App\Observers\UserObserver.
 */
return new class extends Migration
{
    public function up(): void
    {
        $today = now()->toDateString();
        $nowTs = now();

        // Each org's active Morning Shift (case-insensitive name match).
        $shifts = DB::table('shifts')
            ->whereNull('deleted_at')
            ->where('is_active', true)
            ->whereRaw('LOWER(name) = ?', ['morning shift'])
            ->get(['id', 'organization_id']);

        foreach ($shifts as $shift) {
            $userIds = DB::table('users')
                ->where('organization_id', $shift->organization_id)
                ->where('is_active', true)
                ->whereNull('deleted_at')
                ->pluck('id');

            foreach ($userIds as $userId) {
                // Skip users who already have a current active assignment.
                $hasActive = DB::table('user_shifts')
                    ->where('organization_id', $shift->organization_id)
                    ->where('user_id', $userId)
                    ->whereNull('deleted_at')
                    ->where(function ($q) use ($today) {
                        $q->whereNull('effective_to')
                            ->orWhere('effective_to', '>=', $today);
                    })
                    ->exists();

                if ($hasActive) {
                    continue;
                }

                DB::table('user_shifts')->insert([
                    'id' => (string) Str::uuid(),
                    'organization_id' => $shift->organization_id,
                    'user_id' => $userId,
                    'shift_id' => $shift->id,
                    'effective_from' => $today,
                    'effective_to' => null,
                    'created_at' => $nowTs,
                    'updated_at' => $nowTs,
                ]);
            }
        }
    }

    public function down(): void
    {
        // Irreversible data backfill: migration-created assignments cannot be reliably
        // distinguished from manually-created ones. No-op (soft-delete manually if needed).
    }
};
