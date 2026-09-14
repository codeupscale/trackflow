<?php

namespace App\Notifications;

use App\Models\LeaveRequest;
use Carbon\Carbon;

/**
 * A leave request was approved or rejected. Sent to the person who asked.
 *
 * Both outcomes notify. A rejection is the one people most need to hear about
 * — it is the case where their plans change — and telling them only about
 * approvals would make silence ambiguous: "no news" would mean either "still
 * waiting" or "refused".
 */
class LeaveResolved extends TrackflowNotification
{
    public function __construct(
        private readonly LeaveRequest $request,
        private readonly bool $approved,
        private readonly ?string $reason = null,
    ) {}

    public function category(): string
    {
        return $this->approved ? 'leave.approved' : 'leave.rejected';
    }

    public function title(object $notifiable): string
    {
        $type = $this->request->leaveType?->name ?? 'Leave';

        return $this->approved
            ? "{$type} approved"
            : "{$type} request declined";
    }

    public function body(object $notifiable): string
    {
        $dates = $this->dateRange();

        if ($this->approved) {
            return "Your leave for {$dates} has been approved.";
        }

        return $this->reason
            ? "Your leave for {$dates} was declined: {$this->reason}"
            : "Your leave for {$dates} was declined.";
    }

    public function url(object $notifiable): string
    {
        return '/hr/leave';
    }

    public function meta(object $notifiable): array
    {
        return [
            'leave_request_id' => $this->request->id,
            'approved' => $this->approved,
            'days' => (float) $this->request->days_count,
        ];
    }

    /** "12 Mar", or "12–15 Mar" when it spans more than a day. */
    private function dateRange(): string
    {
        $start = Carbon::parse($this->request->start_date);
        $end = Carbon::parse($this->request->end_date);

        if ($start->isSameDay($end)) {
            return $start->format('d M Y');
        }

        return $start->isSameMonth($end)
            ? $start->format('d') . '–' . $end->format('d M Y')
            : $start->format('d M') . ' – ' . $end->format('d M Y');
    }
}
