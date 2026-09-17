<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Why someone left before the hours they owed were done.
 *
 * The day rollup already knows a day was SHORT (met_required_hours = false); it
 * has never known WHY. Without the reason the only honest thing the screen can
 * say is "Early Checkout", which reads as a fault even when a manager approved
 * the departure in advance.
 *
 * Recorded on the DAY row, not the session, because "short day" is a day-level
 * judgement: someone can check out early, come back and finish the hours, at
 * which point the day is no longer short and the reason stops being shown.
 *
 * Write-once at checkout by CheckInService — deliberately not editable
 * afterwards, so nobody can rewrite the story after a manager asks about it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            // One of the fixed categories (medical, family_emergency, …). Kept as a
            // plain string rather than a DB enum so adding a category later is a
            // code change, not a migration against a live table.
            $table->string('early_checkout_category', 40)->nullable()->after('met_required_hours');
            $table->text('early_checkout_reason')->nullable()->after('early_checkout_category');

            // Who permitted it. Optional: a real emergency happens when nobody is
            // reachable, and demanding an approver there would only teach people
            // to skip the reason entirely.
            $table->uuid('early_checkout_approved_by')->nullable()->after('early_checkout_reason');
            $table->timestamp('early_checkout_reason_at')->nullable()->after('early_checkout_approved_by');

            $table->foreign('early_checkout_approved_by')
                ->references('id')->on('users')
                ->nullOnDelete();
        });

        // NO INDEX HERE, deliberately.
        //
        // An earlier version created a partial index on (organization_id, date)
        // WHERE early_checkout_category IS NOT NULL, to back "every explained
        // early checkout this month". Two reasons it is gone:
        //
        // 1. attendance_records ALREADY carries idx_ar_org_date on exactly
        //    (organization_id, date). The partial index is the same two columns
        //    with a filter, so the planner can answer the same question from the
        //    existing index and discard the rows without a reason — a cheap
        //    filter, since explained short days are a small minority.
        // 2. A plain CREATE INDEX takes a lock that blocks WRITES to
        //    attendance_records while it builds, and writes to this table are
        //    people clocking in and out. Paying an outage in the check-in flow
        //    for a duplicate of an index that already exists is a bad trade.
        //
        // If this ever does need its own index, build it CONCURRENTLY in its own
        // migration with `public $withinTransaction = false` — CONCURRENTLY
        // cannot run inside the transaction Laravel wraps PostgreSQL migrations
        // in.
    }

    public function down(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropForeign(['early_checkout_approved_by']);
            $table->dropColumn([
                'early_checkout_category',
                'early_checkout_reason',
                'early_checkout_approved_by',
                'early_checkout_reason_at',
            ]);
        });
    }
};
