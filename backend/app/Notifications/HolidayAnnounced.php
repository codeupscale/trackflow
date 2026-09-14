<?php

namespace App\Notifications;

use App\Models\PublicHoliday;
use Carbon\Carbon;

/**
 * A public holiday was added. Sent to everyone in the organization.
 *
 * The one notification here that is genuinely broadcast rather than addressed:
 * a holiday changes when everybody works, so everybody is a recipient. The
 * banner at the top of the dashboard already shows the NEXT one, but a banner
 * is only seen by whoever happens to open the app that day — an announcement
 * three months ahead would scroll past unnoticed.
 */
class HolidayAnnounced extends TrackflowNotification
{
    public function __construct(
        private readonly PublicHoliday $holiday,
    ) {}

    public function category(): string
    {
        return 'holiday.announced';
    }

    public function title(object $notifiable): string
    {
        return "Holiday announced: {$this->holiday->name}";
    }

    public function body(object $notifiable): string
    {
        $date = Carbon::parse($this->holiday->date);
        $when = $date->format('l, d M Y');

        return ($this->holiday->is_optional ?? false)
            ? "{$when} — optional holiday."
            : "The office is closed on {$when}.";
    }

    public function url(object $notifiable): string
    {
        return '/hr/leave/calendar';
    }

    public function meta(object $notifiable): array
    {
        return [
            'holiday_id' => $this->holiday->id,
            'date' => Carbon::parse($this->holiday->date)->toDateString(),
        ];
    }
}
