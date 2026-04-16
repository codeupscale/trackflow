TrackFlow — Weekly Summary Report
==================================

Hi {{ $userName }},

Here is the weekly summary for {{ $orgName }} from {{ $weekStart }} to {{ $weekEnd }}.

TOTAL HOURS TRACKED: {{ number_format($totalHours, 1) }}

Team Activity: {{ number_format($teamActivity, 0) }}%
Screenshots: {{ number_format($screenshotCount) }}
Pending Leave Requests: {{ $pendingLeaveRequests }}

@if(count($topEmployees) > 0)
TOP PERFORMERS
--------------
@foreach($topEmployees as $index => $employee)
{{ $index + 1 }}. {{ $employee['name'] }} — {{ number_format($employee['hours'], 1) }}h
@endforeach
@endif

View your full report: {{ $dashboardUrl }}

---
You received this email because you subscribed to weekly reports on TrackFlow.
To unsubscribe, visit your notification settings: {{ $dashboardUrl }}/settings
