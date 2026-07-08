<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Idle detection must always be active. Organizations with idle_timeout=0 (legacy
 * "disabled" setting) are corrected to the product default of 5 minutes.
 */
return new class extends Migration
{
    private const DEFAULT_IDLE_TIMEOUT_MIN = 5;

    public function up(): void
    {
        DB::table('organizations')
            ->select('id', 'settings')
            ->orderBy('id')
            ->chunkById(200, function ($orgs) {
                foreach ($orgs as $org) {
                    $settings = json_decode($org->settings ?? '{}', true);
                    if (! is_array($settings) || ! array_key_exists('idle_timeout', $settings)) {
                        continue;
                    }

                    $value = (int) $settings['idle_timeout'];
                    if ($value > 0) {
                        continue;
                    }

                    $settings['idle_timeout'] = self::DEFAULT_IDLE_TIMEOUT_MIN;
                    DB::table('organizations')
                        ->where('id', $org->id)
                        ->update(['settings' => json_encode($settings)]);
                }
            });
    }

    public function down(): void
    {
        // Intentional no-op: re-introducing idle_timeout=0 would disable monitoring.
    }
};
