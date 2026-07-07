<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\Timesheet;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimesheetController extends Controller
{
    // TIME-10: Submit timesheet
    public function submit(Request $request): JsonResponse
    {
        $request->validate([
            'period_start' => 'required|date',
            'period_end' => 'required|date|after_or_equal:period_start',
        ]);

        $user = $request->user();
        $tz = $user->getTimezoneForDates();
        [$dateFromUtc, $dateToUtc] = TimezoneAwareDateRange::toUtcBounds(
            $request->period_start,
            $request->period_end,
            $tz
        );

        // Exclude `idle` entries — they are audit markers (idle time discarded, or
        // duplicated alongside a reassigned tracked entry), so counting them
        // double-counts reassigned windows and counts discarded idle as work.
        // `tracked` and `manual` entries both represent real worked time and count.
        $totalSeconds = TimeEntry::where('user_id', $user->id)
            ->where('started_at', '>=', $dateFromUtc)
            ->where('started_at', '<', $dateToUtc)
            ->whereNotNull('ended_at')
            ->where('type', '!=', 'idle')
            // Exclude pending/rejected manual entries from the submitted total.
            ->where('approval_status', 'approved')
            ->sum('duration_seconds');

        $timesheet = Timesheet::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'period_start' => $request->period_start,
            'period_end' => $request->period_end,
            'total_seconds' => $totalSeconds,
            'status' => 'submitted',
            'submitted_at' => now(),
        ]);

        return response()->json(['timesheet' => $timesheet], 201);
    }

    // TIME-11: Review timesheet
    public function review(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'action' => 'required|in:approve,reject',
            'notes' => 'nullable|string|max:1000',
        ]);

        $timesheet = $request->user()->organization->timesheets()->findOrFail($id);
        $this->authorize('review', $timesheet);

        $timesheet->update([
            'status' => $request->action === 'approve' ? 'approved' : 'rejected',
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json(['timesheet' => $timesheet->fresh()]);
    }
}
