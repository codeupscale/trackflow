<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Clamp organizations.settings->idle_alert_auto_stop_min to a 4-hour maximum.
 *
 * The idle auto-stop grace was validated up to 10080 minutes (7 days) and at
 * least one org had it set to 8600 (~6 days). The desktop multiplies this by 60
 * for the idle popup countdown, so a bad value produced an absurd
 * "Timer will auto-stop in 8597:40" and a timer that effectively never
 * auto-stopped. See bugs/idle-autostop-countdown-wrong.md (Round 2).
 *
 * The validation max is now 240 (SettingsController) and the desktop hard-caps at
 * 240 regardless of the server value (IdleDetector). This migration corrects
 * already-stored values so the displayed/effective grace is sane without relying
 * on the client cap. Only rows ABOVE 240 are touched; deliberate smaller values
 * and orgs that never set the key (backend default = 10) are left untouched.
 *
 * `organizations.settings` is a plain `json` column, so we decode/clamp/encode in
 * PHP (chunked) rather than using a JSON-path numeric comparison, which is
 * unreliable on `json` (vs `jsonb`) across drivers.
 */
return new class extends Migration
{
    private const MAX_AUTO_STOP_MIN = 240; // 4 hours

    public function up(): void
    {
        DB::table('organizations')
            ->select('id', 'settings')
            ->orderBy('id')
            ->chunkById(200, function ($orgs) {
                foreach ($orgs as $org) {
                    $settings = json_decode($org->settings ?? '{}', true);
                    if (!is_array($settings) || !array_key_exists('idle_alert_auto_stop_min', $settings)) {
                        continue;
                    }

                    $value = (int) $settings['idle_alert_auto_stop_min'];
                    if ($value <= self::MAX_AUTO_STOP_MIN) {
                        continue;
                    }

                    $settings['idle_alert_auto_stop_min'] = self::MAX_AUTO_STOP_MIN;
                    DB::table('organizations')
                        ->where('id', $org->id)
                        ->update(['settings' => json_encode($settings)]);
                }
            });
    }

    public function down(): void
    {
        // Intentionally a no-op: the original oversized values were a
        // misconfiguration, and restoring them would re-introduce the bug.
    }
};
