<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill the old hardcoded default timezone.
 *
 * Until 2026-06-17 both new organizations and new users defaulted to
 * 'America/New_York' whenever no timezone was supplied at registration
 * (see bugs/timezone-midnight-rolls-to-previous-day.md). For this PKT-based
 * deployment those values are not deliberate choices — they are the wrong
 * default — and they cause early-morning local activity, screenshots, and
 * attendance to be attributed to the previous day.
 *
 * This migration re-points only rows that still carry the old default to
 * 'Asia/Karachi'. Users/orgs that explicitly chose another zone are untouched
 * (we cannot distinguish a deliberate New_York choice from the default, so this
 * is a one-time, deployment-specific correction — acceptable here because the
 * workforce is in Pakistan).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->where('timezone', 'America/New_York')
            ->update(['timezone' => 'Asia/Karachi']);

        // Organization timezone lives inside the JSON settings column.
        DB::table('organizations')
            ->where('settings->timezone', 'America/New_York')
            ->update(['settings->timezone' => 'Asia/Karachi']);
    }

    public function down(): void
    {
        // Intentionally a no-op: reverting to 'America/New_York' would re-introduce
        // the bug and we cannot reconstruct which rows were originally the default.
    }
};
