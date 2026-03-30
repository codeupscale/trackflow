<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Activity Summary</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937;">
    <!-- Wrapper table for email client compatibility -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Main container -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">

                    <!-- Header with TrackFlow branding -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px 40px; text-align: center;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <!-- TrackFlow Logo Text -->
                                        <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">TrackFlow</h1>
                                        <p style="margin: 8px 0 0 0; font-size: 14px; color: #bfdbfe; font-weight: 400;">Daily Activity Summary</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Greeting -->
                    <tr>
                        <td style="padding: 32px 40px 0 40px;">
                            <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: #111827;">Hi {{ $employee_name }},</p>
                            <p style="margin: 0; font-size: 14px; color: #6b7280;">Here is your activity summary for <strong style="color: #374151;">{{ \Carbon\Carbon::parse($date)->format('l, F j, Y') }}</strong> at <strong style="color: #374151;">{{ $organization_name }}</strong>.</p>
                        </td>
                    </tr>

                    <!-- Stats cards row -->
                    <tr>
                        <td style="padding: 24px 40px 0 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <!-- Total Hours -->
                                    <td width="33%" style="padding: 0 6px 0 0;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border-radius: 8px; border: 1px solid #dbeafe;">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.5px;">Total Hours</p>
                                                    <p style="margin: 6px 0 0 0; font-size: 26px; font-weight: 700; color: #1e40af;">{{ $total_hours }}h</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>

                                    <!-- Activity Percentage -->
                                    <td width="34%" style="padding: 0 3px;">
                                        @php
                                            if ($activity_percentage >= 70) {
                                                $actBg = '#f0fdf4';
                                                $actBorder = '#bbf7d0';
                                                $actLabel = '#16a34a';
                                                $actValue = '#15803d';
                                            } elseif ($activity_percentage >= 40) {
                                                $actBg = '#fefce8';
                                                $actBorder = '#fde68a';
                                                $actLabel = '#ca8a04';
                                                $actValue = '#a16207';
                                            } else {
                                                $actBg = '#fef2f2';
                                                $actBorder = '#fecaca';
                                                $actLabel = '#dc2626';
                                                $actValue = '#b91c1c';
                                            }
                                        @endphp
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: {{ $actBg }}; border-radius: 8px; border: 1px solid {{ $actBorder }};">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; font-weight: 600; color: {{ $actLabel }}; text-transform: uppercase; letter-spacing: 0.5px;">Activity</p>
                                                    <p style="margin: 6px 0 0 0; font-size: 26px; font-weight: 700; color: {{ $actValue }};">{{ $activity_percentage }}%</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>

                                    <!-- Tracked Hours -->
                                    <td width="33%" style="padding: 0 0 0 6px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ff; border-radius: 8px; border: 1px solid #ddd6fe;">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; font-weight: 600; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.5px;">Tracked</p>
                                                    <p style="margin: 6px 0 0 0; font-size: 26px; font-weight: 700; color: #5b21b6;">{{ $tracked_hours }}h</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Activity Progress Bar -->
                    <tr>
                        <td style="padding: 20px 40px 0 40px;">
                            <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #374151;">Activity Level</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background-color: #e5e7eb; border-radius: 6px; height: 12px; padding: 0;">
                                        @php
                                            $barWidth = max($activity_percentage, 2);
                                            if ($activity_percentage >= 70) {
                                                $barColor = '#22c55e';
                                            } elseif ($activity_percentage >= 40) {
                                                $barColor = '#eab308';
                                            } else {
                                                $barColor = '#ef4444';
                                            }
                                        @endphp
                                        <table role="presentation" width="{{ $barWidth }}%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="background-color: {{ $barColor }}; border-radius: 6px; height: 12px; padding: 0;">&nbsp;</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 4px;">
                                <tr>
                                    <td style="font-size: 11px; color: #9ca3af;">0%</td>
                                    <td align="center" style="font-size: 11px; color: #9ca3af;">50%</td>
                                    <td align="right" style="font-size: 11px; color: #9ca3af;">100%</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Project Breakdown -->
                    @if(count($projects) > 0)
                    <tr>
                        <td style="padding: 24px 40px 0 40px;">
                            <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #111827;">Project Breakdown</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                                <!-- Table header -->
                                <tr>
                                    <td style="background-color: #f9fafb; padding: 10px 16px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb;">Project</td>
                                    <td align="right" style="background-color: #f9fafb; padding: 10px 16px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb;">Hours</td>
                                    <td align="right" style="background-color: #f9fafb; padding: 10px 16px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; width: 80px;">Share</td>
                                </tr>
                                @foreach($projects as $index => $project)
                                @php
                                    $projectHours = round($project['total_seconds'] / 3600, 1);
                                    $projectShare = $total_seconds > 0 ? round($project['total_seconds'] / $total_seconds * 100) : 0;
                                    $projectColor = $project['color'] ?? '#6b7280';
                                    $isLast = $index === count($projects) - 1;
                                    $borderBottom = $isLast ? '' : 'border-bottom: 1px solid #f3f4f6;';
                                @endphp
                                <tr>
                                    <td style="padding: 12px 16px; {{ $borderBottom }}">
                                        <table role="presentation" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="width: 10px; padding-right: 10px;">
                                                    <div style="width: 10px; height: 10px; border-radius: 3px; background-color: {{ $projectColor }};"></div>
                                                </td>
                                                <td style="font-size: 14px; font-weight: 500; color: #1f2937;">{{ $project['name'] }}</td>
                                            </tr>
                                        </table>
                                    </td>
                                    <td align="right" style="padding: 12px 16px; font-size: 14px; color: #374151; font-weight: 500; {{ $borderBottom }}">{{ $projectHours }}h</td>
                                    <td align="right" style="padding: 12px 16px; font-size: 13px; color: #6b7280; {{ $borderBottom }}">{{ $projectShare }}%</td>
                                </tr>
                                @endforeach
                            </table>
                        </td>
                    </tr>
                    @endif

                    <!-- Idle time note -->
                    @if($idle_hours > 0)
                    <tr>
                        <td style="padding: 20px 40px 0 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #fefce8; border-radius: 8px; border: 1px solid #fde68a;">
                                <tr>
                                    <td style="padding: 12px 16px; font-size: 13px; color: #92400e;">
                                        <strong>Idle time:</strong> {{ $idle_hours }}h were recorded as idle today.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    @endif

                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 28px 40px 0 40px;" align="center">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background-color: #2563eb; border-radius: 8px;">
                                        <a href="{{ $dashboard_url }}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">View Full Report</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 32px 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="border-top: 1px solid #e5e7eb; padding-top: 24px; text-align: center;">
                                        <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #9ca3af;">TrackFlow</p>
                                        <p style="margin: 0 0 12px 0; font-size: 12px; color: #9ca3af;">Workforce Monitoring Platform</p>
                                        <p style="margin: 0; font-size: 11px; color: #d1d5db;">
                                            This is an automated daily summary from {{ $organization_name }}.
                                            <br>You are receiving this because you are an active member of this organization.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
