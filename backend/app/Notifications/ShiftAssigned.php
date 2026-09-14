<?php

namespace App\Notifications;

use App\Models\Shift;
use Carbon\Carbon;

/**
 * You were put on a shift. Sent to the person assigned.
 *
 * The companion to ShiftTimingUpdated: that one covers hours changing on a
 * shift you already work, this covers being moved onto one at all. Without it
 * an employee learned their new hours by being marked late on the first day.
 */
class ShiftAssigned extends TrackflowNotification
{
    public function __construct(
        private readonly Shift $shift,
        private readonly string $effectiveFrom,
    ) {}

    public function category(): string
    {
        return 'shift.assigned_to_you';
    }

    public function title(object $notifiable): string
    {
        return "You are on {$this->shift->name}";
    }

    public function body(object $notifiable): string
    {
        $hours = substr((string) $this->shift->start_time, 0, 5) . '–' . substr((string) $this->shift->end_time, 0, 5);
        $from = Carbon::parse($this->effectiveFrom);

        // "From today" reads as urgent in a way a date does not, and that is
        // exactly the case where someone needs to change their plans now.
        $when = $from->isToday() ? 'from today' : 'from ' . $from->format('d M Y');

        return "{$hours}, {$when}.";
    }

    public function url(object $notifiable): string
    {
        return '/hr/shifts';
    }

    public function meta(object $notifiable): array
    {
        return [
            'shift_id' => $this->shift->id,
            'effective_from' => $this->effectiveFrom,
        ];
    }
}
