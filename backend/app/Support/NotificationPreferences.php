<?php

namespace App\Support;

use App\Models\User;
use App\Services\PermissionService;

/**
 * Which notifications a person has chosen to silence.
 *
 * Muting is by GROUP, never by raw category. "attendance.checked_in" is an
 * implementation detail; "Check-ins and check-outs" is a decision a person can
 * actually make. Grouping also means a category added later inherits the mute
 * the user already chose for its group, instead of arriving unmuted and
 * undoing their choice.
 *
 * Stored in users.settings, which already exists as a JSON column. A separate
 * preferences table would buy nothing here: the whole thing is one small list
 * read once per notification, always alongside the user row.
 *
 * Muting stops IN-APP delivery (the bell row and the websocket push). It does
 * not stop mail: the only mailed notification is your own payslip, and a
 * payslip is not a message that should vanish because the bell was quiet.
 */
class NotificationPreferences
{
    /**
     * key => [label, description, category prefixes, audience]
     *
     * audience 'org'      — only shown to those who receive org activity
     * audience 'personal' — shown to everyone
     */
    public const GROUPS = [
        'attendance' => ['Check-ins and check-outs', 'Every time someone clocks in or out.', ['attendance.'], 'org'],
        'leave_requests' => ['Leave requests', 'When someone applies for leave.', ['leave.applied'], 'org'],
        'time_entries' => ['Time entry decisions', 'When manual time is approved or rejected.', ['time_entry.'], 'org'],
        'people' => ['People and hiring', 'New joiners, departments and job posts.', ['employee.', 'department.', 'job_posting.'], 'org'],
        'shift_assignments' => ['Shift assignments', 'When people are put on a shift.', ['shift.assigned'], 'org'],
        'assets' => ['Asset hand-overs', 'When company items are assigned or returned.', ['asset.assigned', 'asset.returned'], 'org'],
        'payroll' => ['Payroll activity', 'Runs, payslips released, approvals and payments.', ['payroll.run', 'payroll.payslip_released', 'payroll.completed'], 'org'],
        'my_leave' => ['My leave', 'When your own leave is approved or declined.', ['leave.approved', 'leave.rejected'], 'personal'],
        'my_shifts' => ['My shifts', 'When you are put on a shift or its hours change.', ['shift.timing_updated', 'shift.assigned_to_you'], 'personal'],
        'my_payslips' => ['My payslips', 'When your payslip is ready.', ['payroll.payslip_sent'], 'personal'],
        'my_assets' => ['My company items', 'When an item is assigned to you or your return is recorded.', ['asset.assigned_to_you', 'asset.return_recorded'], 'personal'],
        'holidays' => ['Holidays', 'When a public holiday is announced.', ['holiday.'], 'personal'],
    ];

    /** The group a category belongs to, or null for one no group claims. */
    public static function groupFor(string $category): ?string
    {
        // Longest prefix wins, so 'shift.assigned_to_you' belongs to my_shifts
        // rather than being swallowed by the shorter 'shift.assigned'.
        $match = null;
        $matchLength = -1;

        foreach (self::GROUPS as $key => [, , $prefixes]) {
            foreach ($prefixes as $prefix) {
                if (str_starts_with($category, $prefix) && strlen($prefix) > $matchLength) {
                    $match = $key;
                    $matchLength = strlen($prefix);
                }
            }
        }

        return $match;
    }

    /** @return array<int, string> */
    public static function muted(object $user): array
    {
        $settings = $user->settings ?? [];

        return array_values(array_intersect(
            (array) ($settings['notifications']['muted'] ?? []),
            array_keys(self::GROUPS),
        ));
    }

    public static function isMuted(object $user, string $category): bool
    {
        $group = self::groupFor($category);

        return $group !== null && in_array($group, self::muted($user), true);
    }

    /**
     * The groups this person can meaningfully control.
     *
     * Someone who never receives org activity is not offered switches for it:
     * a toggle that changes nothing is a lie on the settings screen.
     */
    public static function forUser(User $user): array
    {
        $receivesOrg = app(PermissionService::class)
            ->hasPermission($user, 'notifications.receive_org_activity');
        $muted = self::muted($user);
        $out = [];

        foreach (self::GROUPS as $key => [$label, $description, , $audience]) {
            if ($audience === 'org' && ! $receivesOrg) {
                continue;
            }

            $out[] = [
                'key' => $key,
                'label' => $label,
                'description' => $description,
                'audience' => $audience,
                'muted' => in_array($key, $muted, true),
            ];
        }

        return $out;
    }

    /** @param array<int, string> $muted */
    public static function save(User $user, array $muted): void
    {
        $settings = $user->settings ?? [];
        $settings['notifications']['muted'] = array_values(array_unique(
            array_intersect($muted, array_keys(self::GROUPS)),
        ));

        $user->forceFill(['settings' => $settings])->save();
    }
}
