<?php

namespace App\Jobs;

use App\Mail\WeeklyReportMail;
use App\Models\LeaveRequest;
use App\Models\ReportSubscription;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\ReportService;
use Carbon\Carbon;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SendWeeklyReportJob implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 60;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function uniqueId(): string
    {
        return 'weekly-report:' . now()->toDateString();
    }

    public function handle(ReportService $reportService): void
    {
        $todayIso = Carbon::now()->dayOfWeekIso; // 1=Monday..7=Sunday

        // Query subscriptions that should fire today, chunked for memory safety.
        // Using withoutGlobalScopes because this runs in system context (no auth user).
        ReportSubscription::withoutGlobalScopes()
            ->where('report_type', 'weekly_summary')
            ->where('is_active', true)
            ->where('day_of_week', $todayIso)
            ->with('user')
            ->chunkById(100, function ($subscriptions) use ($reportService) {
                foreach ($subscriptions as $subscription) {
                    try {
                        $this->sendForSubscription($subscription, $reportService);
                    } catch (\Throwable $e) {
                        Log::error("SendWeeklyReportJob: failed for subscription {$subscription->id}", [
                            'organization_id' => $subscription->organization_id,
                            'user_id' => $subscription->user_id,
                            'error' => $e->getMessage(),
                        ]);
                        // Continue with next subscription
                    }
                }
            });
    }

    private function sendForSubscription(ReportSubscription $subscription, ReportService $reportService): void
    {
        $user = $subscription->user;
        if (!$user) {
            return;
        }

        $orgId = $subscription->organization_id;
        $weekEnd = Carbon::now()->subDay()->toDateString();  // yesterday
        $weekStart = Carbon::now()->subDays(7)->toDateString();  // 7 days ago

        $dashboardUrl = rtrim(config('app.frontend_url', config('app.url')), '/') . '/reports';

        // Gather stats using ReportService (org-scoped via explicit org_id)
        $summary = $reportService->summary($orgId, null, $weekStart, $weekEnd);
        $totalHours = isset($summary['total_seconds']) ? round($summary['total_seconds'] / 3600, 1) : 0;
        $teamActivity = $summary['activity_score_avg'] ?? 0;

        // Top 3 employees by hours — raw query with explicit org_id scope
        $topEmployees = DB::table('time_entries')
            ->join('users', 'time_entries.user_id', '=', 'users.id')
            ->where('time_entries.organization_id', $orgId)
            ->where('time_entries.started_at', '>=', $weekStart)
            ->where('time_entries.started_at', '<', Carbon::parse($weekEnd)->addDay()->toDateString())
            ->whereNotNull('time_entries.ended_at')
            ->select(
                'users.name',
                DB::raw('SUM(time_entries.duration_seconds) as total_seconds')
            )
            ->groupBy('users.id', 'users.name')
            ->orderByDesc('total_seconds')
            ->limit(3)
            ->get()
            ->map(fn ($row) => [
                'name' => $row->name,
                'hours' => round($row->total_seconds / 3600, 1),
            ])
            ->toArray();

        // Screenshot count for the week
        $screenshotCount = Screenshot::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('captured_at', '>=', $weekStart)
            ->where('captured_at', '<', Carbon::parse($weekEnd)->addDay()->toDateString())
            ->count();

        // Pending leave requests count
        $pendingLeaveRequests = LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('status', 'pending')
            ->count();

        // Get org name
        $orgName = DB::table('organizations')->where('id', $orgId)->value('name') ?? 'Your Organization';

        Mail::to($user->email)->queue(
            new WeeklyReportMail(
                userName: $user->name,
                orgName: $orgName,
                weekStart: Carbon::parse($weekStart)->format('M j'),
                weekEnd: Carbon::parse($weekEnd)->format('M j, Y'),
                totalHours: $totalHours,
                topEmployees: $topEmployees,
                teamActivity: $teamActivity,
                screenshotCount: $screenshotCount,
                pendingLeaveRequests: $pendingLeaveRequests,
                dashboardUrl: $dashboardUrl,
            )
        );

        // Mark as sent
        $subscription->update(['last_sent_at' => now()]);
    }

    public function backoff(): array
    {
        return [30, 60, 120];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical('SendWeeklyReportJob failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
