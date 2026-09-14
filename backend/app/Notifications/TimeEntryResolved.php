<?php

namespace App\Notifications;

use App\Models\TimeEntry;
use Carbon\Carbon;

/**
 * Your manual time entry was approved or rejected. Sent to its owner.
 *
 * Manual time is pending until someone decides it, and pending time is
 * invisible to every report, payslip and dashboard total. Without this the
 * employee had no way to learn their hours had been refused except to notice,
 * eventually, that a total looked short.
 */
class TimeEntryResolved extends TrackflowNotification
{
    public function __construct(
        private readonly TimeEntry $entry,
        private readonly bool $approved,
        private readonly string $approverName,
        private readonly ?string $reason = null,
    ) {}

    public function category(): string
    {
        return $this->approved ? 'time_entry.approved' : 'time_entry.rejected';
    }

    public function title(object $notifiable): string
    {
        return $this->approved
            ? 'Your time entry was approved'
            : 'Your time entry was rejected';
    }

    public function body(object $notifiable): string
    {
        $seconds = (int) ($this->entry->duration_seconds ?? 0);
        $hours = sprintf('%dh %02dm', intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
        $day = Carbon::parse($this->entry->started_at)->format('d M Y');

        if ($this->approved) {
            return "{$hours} on {$day}, approved by {$this->approverName}. It now counts toward your totals.";
        }

        // The reason is the whole point of a rejection: without it the person
        // cannot fix the entry and resubmit.
        return $this->reason
            ? "{$hours} on {$day}, rejected by {$this->approverName}: {$this->reason}"
            : "{$hours} on {$day}, rejected by {$this->approverName}.";
    }

    public function url(object $notifiable): string
    {
        return '/time';
    }

    public function meta(object $notifiable): array
    {
        return [
            'entry_id' => $this->entry->id,
            'approved' => $this->approved,
        ];
    }
}
