<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Raise the idle detection window from 5 to 10 minutes (owner request, 2026-07-16).
 *
 * Organization::getDefaultSettings() only applies to orgs that never persisted a
 * value — every existing org has idle_timeout written into organizations.settings
 * at creation time, so changing the code default alone would have been a no-op for
 * all of them.
 *
 * This ONLY rewrites rows sitting on the exact OLD default (5). An org that has
 * deliberately chosen any other value (20, a custom 15, …) is left untouched —
 * this is a default bump, not a policy override.
 *
 * Note this value now governs two things: the idle alert, and the desktop's
 * sleep-gap auto-stop on resume (a sleep longer than this closes the entry,
 * back-dated to the last real activity).
 */
return new class extends Migration
{
    private const OLD_DEFAULT_MIN = 5;

    private const NEW_DEFAULT_MIN = 10;

    public function up(): void
    {
        $this->rewrite(self::OLD_DEFAULT_MIN, self::NEW_DEFAULT_MIN);
    }

    public function down(): void
    {
        // Symmetric: put orgs still on the new default back on the old one.
        $this->rewrite(self::NEW_DEFAULT_MIN, self::OLD_DEFAULT_MIN);
    }

    private function rewrite(int $from, int $to): void
    {
        DB::table('organizations')
            ->select('id', 'settings')
            ->orderBy('id')
            ->chunkById(200, function ($orgs) use ($from, $to) {
                foreach ($orgs as $org) {
                    $settings = json_decode($org->settings ?? '{}', true);
                    if (! is_array($settings) || ! array_key_exists('idle_timeout', $settings)) {
                        // Never persisted — the code default already applies.
                        continue;
                    }

                    if ((int) $settings['idle_timeout'] !== $from) {
                        continue;
                    }

                    $settings['idle_timeout'] = $to;
                    DB::table('organizations')
                        ->where('id', $org->id)
                        ->update(['settings' => json_encode($settings)]);
                }
            });
    }
};
