<?php

namespace App\Notifications;

/**
 * One class for the organisation-activity stream.
 *
 * Nine categories share a shape — "X happened, here is who and what, go here to
 * see it" — and nine near-identical classes would be nine places to fix the day
 * the payload changes. The variation that matters is the WORDING, and that is
 * data: each named constructor below writes its own line and hands over the
 * context a reader needs to act WITHOUT opening the screen first.
 *
 * The named constructors are the API. Never `new OrgActivity(...)` at a call
 * site — the constructor is private precisely so a caller cannot invent a
 * category the frontend has no icon for.
 */
class OrgActivity extends TrackflowNotification
{
    private function __construct(
        private readonly string $kind,
        private readonly string $heading,
        private readonly string $detail,
        private readonly string $link,
        private readonly array $extra = [],
    ) {}

    public function category(): string
    {
        return $this->kind;
    }

    public function title(object $notifiable): string
    {
        return $this->heading;
    }

    public function body(object $notifiable): string
    {
        return $this->detail;
    }

    public function url(object $notifiable): string
    {
        return $this->link;
    }

    public function meta(object $notifiable): array
    {
        return $this->extra;
    }

    // ── Time entries ──────────────────────────────────────────────────

    public static function timeEntryResolved(
        string $employeeName,
        string $approverName,
        bool $approved,
        string $hours,
        string $day,
        ?string $reason = null,
        ?string $entryId = null,
    ): self {
        $verdict = $approved ? 'approved' : 'rejected';

        return new self(
            $approved ? 'time_entry.approved' : 'time_entry.rejected',
            "{$employeeName} time entry {$verdict}",
            // Hours and day, not merely "an entry": the first question anyone
            // asks on seeing this is how much time was accepted, and for when.
            $reason
                ? "{$hours} on {$day}, {$verdict} by {$approverName}: {$reason}"
                : "{$hours} on {$day}, {$verdict} by {$approverName}.",
            '/time-entries/approvals',
            ['employee' => $employeeName, 'approved' => $approved, 'entry_id' => $entryId],
        );
    }

    // ── People and structure ──────────────────────────────────────────

    public static function employeeAdded(string $name, string $email, string $role, ?string $userId = null): self
    {
        return new self(
            'employee.added',
            "{$name} joined the organisation",
            // The role is the actionable half: it decides what they can see,
            // and a wrong one is the mistake nobody notices for weeks.
            "{$email} · joined as " . str_replace('_', ' ', $role) . '.',
            $userId ? "/hr/employees/{$userId}" : '/hr/employees',
            ['user_id' => $userId, 'role' => $role],
        );
    }

    public static function departmentCreated(string $name, string $createdBy, ?string $parent = null): self
    {
        return new self(
            'department.created',
            "New department: {$name}",
            $parent
                ? "Created by {$createdBy}, under {$parent}."
                : "Created by {$createdBy}, at the top level.",
            '/hr/departments',
            ['department' => $name, 'parent' => $parent],
        );
    }

    public static function jobPosted(string $title, string $postedBy, ?string $department, string $status, ?string $jobId = null): self
    {
        return new self(
            'job_posting.created',
            "New job post: {$title}",
            trim(($department ? "{$department} · " : '') . ucfirst($status) . ", posted by {$postedBy}."),
            '/hr/job-postings',
            ['job_id' => $jobId, 'status' => $status],
        );
    }

    // ── Leave ─────────────────────────────────────────────────────────

    public static function leaveApplied(string $employeeName, string $type, string $dates, float $days, ?string $requestId = null): self
    {
        $unit = $days === 1.0 ? 'day' : 'days';

        return new self(
            'leave.applied',
            "{$employeeName} requested leave",
            // Type, dates and length together, because that is exactly what an
            // approver weighs — it saves opening the screen to spot a clash.
            "{$type} · {$dates} · {$days} {$unit}. Awaiting approval.",
            '/hr/leave/approvals',
            ['employee' => $employeeName, 'days' => $days, 'request_id' => $requestId],
        );
    }

    // ── Attendance ────────────────────────────────────────────────────

    /**
     * @param  string|null  $earlyReason  The explanation given at checkout, already
     *   composed as "Medical appointment — dentist, approved by Hina HR". Carrying
     *   it in the body is the difference between a notification that prompts a
     *   question and one that answers it, so the reader never has to open the
     *   attendance screen to find out why someone left.
     */
    public static function checkedOut(string $employeeName, string $at, string $worked, bool $early, int $earlyMinutes, ?string $earlyReason = null): self
    {
        $title = $early
            ? ($earlyReason !== null
                ? "{$employeeName} checked out early (reason given)"
                : "{$employeeName} checked out early")
            : "{$employeeName} checked out";

        // "539 minutes early" is a number the reader has to do arithmetic on
        // before it means anything; "8h 59m early" is the same fact, already
        // understood.
        $body = $early
            ? "Left at {$at}, " . self::humanMinutes($earlyMinutes) . " early. {$worked} worked today."
            : "Left at {$at}. {$worked} worked today.";

        if ($early && $earlyReason !== null) {
            $body .= " Reason: {$earlyReason}";
        }

        return new self(
            'attendance.checked_out',
            $title,
            $body,
            '/hr/attendance/team',
            [
                'employee' => $employeeName,
                'early' => $early,
                'early_minutes' => $earlyMinutes,
                'early_reason' => $earlyReason,
            ],
        );
    }

    /**
     * A minute count as a duration someone can read at a glance:
     * 539 → "8h 59m", 45 → "45m", 120 → "2h", 0 → "under a minute".
     */
    private static function humanMinutes(int $minutes): string
    {
        if ($minutes <= 0) {
            return 'under a minute';
        }

        $hours = intdiv($minutes, 60);
        $rest = $minutes % 60;

        if ($hours === 0) {
            return "{$rest}m";
        }

        return $rest === 0 ? "{$hours}h" : "{$hours}h {$rest}m";
    }

    // ── Payroll ───────────────────────────────────────────────────────

    public static function payrollRun(string $period, string $runBy, int $payslips, string $gross): self
    {
        return new self(
            'payroll.run',
            "Payroll run for {$period}",
            "{$runBy} generated {$payslips} " . ($payslips === 1 ? 'payslip' : 'payslips')
                . ", {$gross} gross. Ready to review.",
            '/hr/payroll',
            ['period' => $period, 'payslips' => $payslips],
        );
    }

    public static function payslipReleased(string $employeeName, string $period, string $sentBy): self
    {
        return new self(
            'payroll.payslip_released',
            "Payslip sent to {$employeeName}",
            "{$period}, released by {$sentBy}.",
            '/hr/payroll',
            ['employee' => $employeeName, 'period' => $period],
        );
    }

    public static function payrollCompleted(string $period, string $by, string $net, int $payslips, string $stage): self
    {
        return new self(
            'payroll.completed',
            $stage === 'paid'
                ? "Payroll paid for {$period}"
                : "Payroll approved for {$period}",
            "{$payslips} " . ($payslips === 1 ? 'payslip' : 'payslips') . ", {$net} net, by {$by}.",
            '/hr/payroll',
            ['period' => $period, 'stage' => $stage],
        );
    }

    // ── Shifts ────────────────────────────────────────────────────────

    public static function shiftAssigned(string $shiftName, string $hours, string $who, string $from): self
    {
        return new self(
            'shift.assigned',
            "Shift assigned: {$shiftName}",
            "{$who} · {$hours}, from {$from}.",
            '/hr/shifts/assignments',
            ['shift' => $shiftName],
        );
    }

    // ── Attendance (check-in half) ────────────────────────────────────

    public static function checkedIn(string $employeeName, string $at, bool $late, int $lateMinutes, int $session = 1): self
    {
        // Lateness belongs to the FIRST check-in of the day only. The day
        // record keeps check_in_status from session 1, so without this guard a
        // return from lunch at 14:00 was announced as "checked in, 384 minutes
        // late" — the morning's lateness, re-reported against the afternoon.
        $returning = $session > 1;
        $late = $late && ! $returning;

        return new self(
            'attendance.checked_in',
            match (true) {
                $returning => "{$employeeName} is back",
                $late => "{$employeeName} checked in late",
                default => "{$employeeName} checked in",
            },
            match (true) {
                // A second session reads as a mistake unless it says so.
                $returning => "Checked in again at {$at} (session {$session}).",
                $late => "Checked in at {$at}, " . self::humanMinutes($lateMinutes) . ' late.',
                default => "Checked in at {$at}.",
            },
            '/hr/attendance/team',
            ['employee' => $employeeName, 'status' => $late ? 'late' : 'on_time', 'late_minutes' => $late ? $lateMinutes : 0, 'session' => $session],
        );
    }

    // ── Assets ────────────────────────────────────────────────────────

    public static function assetAssigned(string $assetName, string $assetTag, string $holderName, string $by): self
    {
        return new self(
            'asset.assigned',
            "{$assetName} assigned to {$holderName}",
            "{$assetTag}, handed over by {$by}.",
            '/hr/assets',
            ['asset_tag' => $assetTag, 'holder' => $holderName],
        );
    }

    public static function assetReturned(string $assetName, string $assetTag, string $fromName, string $condition, string $statusAfter): self
    {
        // A return that sends the item to repair, or records it lost, is the
        // version someone needs to act on — so it says so in the title.
        $title = match ($statusAfter) {
            'lost' => "{$assetName} reported lost by {$fromName}",
            'in_repair' => "{$assetName} returned for repair",
            default => "{$assetName} returned by {$fromName}",
        };

        return new self(
            'asset.returned',
            $title,
            "{$assetTag} · condition: {$condition}.",
            '/hr/assets',
            ['asset_tag' => $assetTag, 'condition' => $condition, 'status' => $statusAfter],
        );
    }
}
