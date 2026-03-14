<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>TrackFlow Report &mdash; {{ ucfirst($type) }}</title>
    <style>
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 12px;
            color: #333;
            margin: 40px;
        }
        h1 {
            font-size: 22px;
            margin-bottom: 4px;
        }
        .meta {
            color: #666;
            margin-bottom: 24px;
            font-size: 11px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px 10px;
            text-align: left;
        }
        th {
            background-color: #f5f5f5;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        tr:nth-child(even) {
            background-color: #fafafa;
        }
        .summary-box {
            background: #f0f4ff;
            border: 1px solid #d0d8f0;
            border-radius: 6px;
            padding: 12px 16px;
            margin-bottom: 20px;
            display: inline-block;
            margin-right: 12px;
        }
        .summary-box .label {
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
        }
        .summary-box .value {
            font-size: 18px;
            font-weight: 700;
            color: #1a1a1a;
        }
        .footer {
            margin-top: 40px;
            font-size: 10px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
    </style>
</head>
<body>
    <h1>{{ ucfirst($type) }} Report</h1>
    <div class="meta">Period: {{ $dateFrom }} &mdash; {{ $dateTo }} | Generated: {{ now()->toDateTimeString() }}</div>

    @if($type === 'summary')
        <div>
            <div class="summary-box">
                <div class="label">Total Hours</div>
                <div class="value">{{ number_format(($data['total_seconds'] ?? 0) / 3600, 1) }}</div>
            </div>
            <div class="summary-box">
                <div class="label">Avg Activity</div>
                <div class="value">{{ number_format($data['avg_activity'] ?? 0, 0) }}%</div>
            </div>
            <div class="summary-box">
                <div class="label">Total Entries</div>
                <div class="value">{{ $data['total_entries'] ?? 0 }}</div>
            </div>
            <div class="summary-box">
                <div class="label">Earnings</div>
                <div class="value">${{ number_format($data['total_earnings'] ?? 0, 2) }}</div>
            </div>
        </div>

        @if(!empty($data['daily']))
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Hours</th>
                        <th>Activity Score</th>
                        <th>Entries</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($data['daily'] as $row)
                        <tr>
                            <td>{{ $row->date ?? $row['date'] ?? '' }}</td>
                            <td>{{ number_format(($row->total_seconds ?? $row['total_seconds'] ?? 0) / 3600, 1) }}</td>
                            <td>{{ number_format($row->activity_score_avg ?? $row['activity_score_avg'] ?? 0, 0) }}%</td>
                            <td>{{ $row->entry_count ?? $row['entry_count'] ?? 0 }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        @endif

    @elseif($type === 'team')
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Hours</th>
                    <th>Activity</th>
                    <th>Entries</th>
                </tr>
            </thead>
            <tbody>
                @foreach($data as $row)
                    <tr>
                        <td>{{ $row['user']['name'] }}</td>
                        <td>{{ $row['user']['email'] }}</td>
                        <td>{{ ucfirst($row['user']['role']) }}</td>
                        <td>{{ number_format(($row['total_seconds'] ?? 0) / 3600, 1) }}</td>
                        <td>{{ $row['avg_activity'] ?? 0 }}%</td>
                        <td>{{ $row['entry_count'] ?? 0 }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>

    @elseif($type === 'projects')
        @foreach($data as $project)
            <h3 style="margin-top: 20px; margin-bottom: 4px;">
                <span style="display:inline-block;width:12px;height:12px;background:{{ $project['color'] ?? '#ccc' }};border-radius:2px;margin-right:6px;"></span>
                {{ $project['project_name'] }}
                ({{ number_format(($project['total_seconds'] ?? 0) / 3600, 1) }}h)
            </h3>
            @if(!empty($project['tasks']))
                <table>
                    <thead>
                        <tr>
                            <th>Task</th>
                            <th>Hours</th>
                            <th>Entries</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach($project['tasks'] as $task)
                            <tr>
                                <td>{{ $task['task_name'] ?? 'No task' }}</td>
                                <td>{{ number_format(($task['total_seconds'] ?? 0) / 3600, 1) }}</td>
                                <td>{{ $task['entry_count'] ?? 0 }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @endif
        @endforeach

    @elseif($type === 'payroll')
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Total Hours</th>
                    <th>Billable Hours</th>
                    <th>Earnings</th>
                </tr>
            </thead>
            <tbody>
                @foreach($data as $row)
                    <tr>
                        <td>{{ $row['user']['name'] }}</td>
                        <td>{{ $row['user']['email'] }}</td>
                        <td>{{ $row['total_hours'] }}</td>
                        <td>{{ $row['billable_hours'] }}</td>
                        <td>${{ number_format($row['earnings'], 2) }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>

    @elseif($type === 'attendance')
        <table>
            <thead>
                <tr>
                    <th>User ID</th>
                    <th>Date</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                    <th>Total Hours</th>
                </tr>
            </thead>
            <tbody>
                @foreach($data as $row)
                    <tr>
                        <td>{{ $row->user_id ?? $row['user_id'] ?? '' }}</td>
                        <td>{{ $row->date ?? $row['date'] ?? '' }}</td>
                        <td>{{ $row->first_seen ?? $row['first_seen'] ?? '' }}</td>
                        <td>{{ $row->last_seen ?? $row['last_seen'] ?? '' }}</td>
                        <td>{{ number_format(($row->total_seconds ?? $row['total_seconds'] ?? 0) / 3600, 1) }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>

    @else
        <pre>{{ json_encode($data, JSON_PRETTY_PRINT) }}</pre>
    @endif

    <div class="footer">
        TrackFlow &mdash; Report generated automatically.
    </div>
</body>
</html>
