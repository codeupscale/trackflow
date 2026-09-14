<?php

namespace App\Notifications;

use App\Models\Shift;

/**
 * A shift's hours changed. Sent to the people assigned to it.
 *
 * Only ever raised when the TIMING moved — start, end, grace or timezone.
 * Renaming a shift or recolouring it changes nothing about when someone is
 * expected at their desk, and a notification for that trains people to ignore
 * the ones that matter. The old hours are quoted beside the new ones, because
 * "your shift changed" without them sends the reader hunting for what changed.
 */
class ShiftTimingUpdated extends TrackflowNotification
{
    /**
     * @param  array<string, array{from: mixed, to: mixed}>  $changes
     */
    public function __construct(
        private readonly Shift $shift,
        private readonly array $changes,
    ) {}

    public function category(): string
    {
        return 'shift.timing_updated';
    }

    public function title(object $notifiable): string
    {
        return "Your shift hours changed: {$this->shift->name}";
    }

    public function body(object $notifiable): string
    {
        $start = $this->changes['start_time'] ?? null;
        $end = $this->changes['end_time'] ?? null;

        // The common case, and the only one worth spelling out in full.
        if ($start || $end) {
            $was = $this->time($start['from'] ?? $this->shift->start_time)
                . '–' . $this->time($end['from'] ?? $this->shift->end_time);
            $now = $this->time($this->shift->start_time)
                . '–' . $this->time($this->shift->end_time);

            return "Now {$now}, was {$was}.";
        }

        if (isset($this->changes['grace_period_minutes'])) {
            $to = (int) $this->changes['grace_period_minutes']['to'];

            return $to > 0
                ? "The grace period is now {$to} minutes."
                : 'The grace period has been removed.';
        }

        if (isset($this->changes['timezone'])) {
            return "Your shift is now kept in {$this->changes['timezone']['to']} time.";
        }

        return 'Your working hours have been updated.';
    }

    public function url(object $notifiable): string
    {
        return '/hr/shifts';
    }

    public function meta(object $notifiable): array
    {
        return [
            'shift_id' => $this->shift->id,
            'shift_name' => $this->shift->name,
            'changed' => array_keys($this->changes),
        ];
    }

    /** "09:00:00" reads as a database value; "09:00" reads as a time. */
    private function time(?string $value): string
    {
        return $value ? substr($value, 0, 5) : '--';
    }
}
