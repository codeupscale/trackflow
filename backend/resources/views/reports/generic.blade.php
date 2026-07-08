<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #333; padding: 20px; }
        h1 { color: #2563eb; font-size: 24px; margin-bottom: 5px; }
        .subtitle { color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background-color: #f3f4f6; text-align: left; padding: 8px; border-bottom: 2px solid #e5e7eb; font-size: 11px; }
        td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) { background-color: #f9fafb; }
        .summary { background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .summary span { font-weight: bold; }
        .footer { margin-top: 30px; color: #999; font-size: 10px; border-top: 1px solid #eee; padding-top: 10px; }
    </style>
</head>
<body>
    <h1>TrackFlow — {{ ucfirst($type) }} Report</h1>
    <p class="subtitle">{{ $dateFrom }} to {{ $dateTo }}</p>

    @if($type === 'summary' && isset($data['daily']))
        <div class="summary">
            Time Utilized: <span>{{ round(($data['total_seconds_tracked'] ?? 0) / 3600, 2) }}h</span> |
            Idle: <span>{{ round(($data['total_seconds_idle'] ?? 0) / 3600, 2) }}h</span> |
            Avg Activity: <span>{{ round($data['avg_activity'] ?? 0) }}%</span> |
            Total Entries: <span>{{ $data['total_entries'] ?? 0 }}</span> |
            Earnings: <span>${{ number_format($data['total_earnings'] ?? 0, 2) }}</span>
        </div>
        <table>
            <tr><th>Date</th><th>Time Utilized (h)</th><th>Idle (h)</th><th>Activity %</th><th>Entries</th></tr>
            @foreach($data['daily'] as $row)
            <tr>
                <td>{{ $row->date ?? ($row['date'] ?? '') }}</td>
                <td>{{ round(($row->tracked_seconds ?? ($row['tracked_seconds'] ?? 0)) / 3600, 2) }}</td>
                <td>{{ round(($row->idle_seconds ?? ($row['idle_seconds'] ?? 0)) / 3600, 2) }}</td>
                <td>{{ round($row->activity_score_avg ?? ($row['activity_score_avg'] ?? 0)) }}%</td>
                <td>{{ $row->entry_count ?? ($row['entry_count'] ?? 0) }}</td>
            </tr>
            @endforeach
        </table>
    @elseif($type === 'team' && is_array($data))
        <table>
            <tr><th>Name</th><th>Email</th><th>Time Utilized (h)</th><th>Idle (h)</th><th>Activity %</th><th>Entries</th></tr>
            @foreach($data as $row)
            <tr>
                <td>{{ $row['user']['name'] ?? '' }}</td>
                <td>{{ $row['user']['email'] ?? '' }}</td>
                <td>{{ round((max(($row['total_seconds'] ?? 0) - ($row['seconds_idle'] ?? 0), 0)) / 3600, 2) }}</td>
                <td>{{ round(($row['seconds_idle'] ?? 0) / 3600, 2) }}</td>
                <td>{{ $row['avg_activity'] ?? 0 }}%</td>
                <td>{{ $row['entry_count'] ?? 0 }}</td>
            </tr>
            @endforeach
        </table>
    @elseif($type === 'payroll' && is_array($data))
        <table>
            <tr><th>Name</th><th>Email</th><th>Total Hours</th><th>Billable Hours</th><th>Earnings</th></tr>
            @foreach($data as $row)
            <tr>
                <td>{{ $row['user']['name'] ?? '' }}</td>
                <td>{{ $row['user']['email'] ?? '' }}</td>
                <td>{{ $row['total_hours'] ?? 0 }}</td>
                <td>{{ $row['billable_hours'] ?? 0 }}</td>
                <td>${{ number_format($row['earnings'] ?? 0, 2) }}</td>
            </tr>
            @endforeach
        </table>
    @elseif($type === 'attendance' && is_array($data))
        <table>
            <tr><th>Employee</th><th>Date</th><th>First Seen</th><th>Last Seen</th><th>Time Utilized (h)</th></tr>
            @foreach($data as $row)
            <tr>
                <td>{{ $row->user_name ?? ($row['user_name'] ?? '') }}</td>
                <td>{{ $row->date ?? ($row['date'] ?? '') }}</td>
                <td>{{ $row->first_seen ?? ($row['first_seen'] ?? '') }}</td>
                <td>{{ $row->last_seen ?? ($row['last_seen'] ?? '') }}</td>
                <td>{{ round(($row->total_seconds ?? ($row['total_seconds'] ?? 0)) / 3600, 2) }}</td>
            </tr>
            @endforeach
        </table>
    @elseif($type === 'projects' && is_array($data))
        <table>
            <tr><th>Project</th><th>Time Utilized (h)</th></tr>
            @foreach($data as $project)
            <tr>
                <td style="color: {{ $project['color'] ?? '#333' }}">{{ $project['name'] ?? $project['project_name'] ?? 'Unknown' }}</td>
                <td>{{ $project['total_hours'] ?? round(($project['total_seconds'] ?? 0) / 3600, 2) }}</td>
            </tr>
            @endforeach
        </table>
    @elseif($type === 'apps' && is_array($data))
        <table>
            <tr><th>Employee</th><th>Application</th><th>Time Utilized (h)</th><th>Days Used</th></tr>
            @foreach($data as $row)
            <tr>
                <td>{{ $row['user_name'] ?? '' }}</td>
                <td>{{ $row['active_app'] ?? '' }}</td>
                <td>{{ round(($row['duration_seconds'] ?? 0) / 3600, 2) }}</td>
                <td>{{ $row['days_used'] ?? 0 }}</td>
            </tr>
            @endforeach
        </table>
    @else
        <pre>{{ json_encode($data, JSON_PRETTY_PRINT) }}</pre>
    @endif

    <div class="footer">Generated by TrackFlow on {{ now()->format('F j, Y \\a\\t g:i A') }}</div>
</body>
</html>
