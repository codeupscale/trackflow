<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weekly Summary Report</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">

                    <!-- Header with TrackFlow amber branding -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); padding: 32px 40px; text-align: center;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">TrackFlow</h1>
                            <p style="margin: 8px 0 0 0; font-size: 14px; color: #FEF3C7; font-weight: 400;">Weekly Summary Report</p>
                        </td>
                    </tr>

                    <!-- Greeting -->
                    <tr>
                        <td style="padding: 32px 40px 0 40px;">
                            <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: #111827;">Hi {{ $userName }},</p>
                            <p style="margin: 0; font-size: 14px; color: #6b7280;">Here is the weekly summary for <strong style="color: #374151;">{{ $orgName }}</strong> from <strong style="color: #374151;">{{ $weekStart }}</strong> to <strong style="color: #374151;">{{ $weekEnd }}</strong>.</p>
                        </td>
                    </tr>

                    <!-- Total Hours - Big Number -->
                    <tr>
                        <td style="padding: 24px 40px 0 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #FFFBEB; border-radius: 8px; border: 1px solid #FDE68A;">
                                <tr>
                                    <td style="padding: 24px; text-align: center;">
                                        <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #92400E; font-weight: 600;">Total Hours Tracked</p>
                                        <p style="margin: 8px 0 0 0; font-size: 42px; font-weight: 700; color: #B45309; line-height: 1;">{{ number_format($totalHours, 1) }}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Stats Row -->
                    <tr>
                        <td style="padding: 16px 40px 0 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="33%" style="padding: 8px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; border-radius: 8px; border: 1px solid #E5E7EB;">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6B7280; font-weight: 600;">Activity</p>
                                                    <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: 700; color: #111827;">{{ number_format($teamActivity, 0) }}%</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                    <td width="33%" style="padding: 8px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; border-radius: 8px; border: 1px solid #E5E7EB;">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6B7280; font-weight: 600;">Screenshots</p>
                                                    <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: 700; color: #111827;">{{ number_format($screenshotCount) }}</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                    <td width="33%" style="padding: 8px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; border-radius: 8px; border: 1px solid #E5E7EB;">
                                            <tr>
                                                <td style="padding: 16px; text-align: center;">
                                                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6B7280; font-weight: 600;">Pending Leave</p>
                                                    <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: 700; color: {{ $pendingLeaveRequests > 0 ? '#DC2626' : '#111827' }};">{{ $pendingLeaveRequests }}</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Top Employees Table -->
                    @if(count($topEmployees) > 0)
                    <tr>
                        <td style="padding: 24px 40px 0 40px;">
                            <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.5px;">Top Performers</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
                                <tr style="background-color: #F9FAFB;">
                                    <td style="padding: 10px 16px; font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E5E7EB;">#</td>
                                    <td style="padding: 10px 16px; font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E5E7EB;">Name</td>
                                    <td style="padding: 10px 16px; font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E5E7EB; text-align: right;">Hours</td>
                                </tr>
                                @foreach($topEmployees as $index => $employee)
                                <tr>
                                    <td style="padding: 12px 16px; font-size: 14px; color: #6B7280;{{ !$loop->last ? ' border-bottom: 1px solid #F3F4F6;' : '' }}">{{ $index + 1 }}</td>
                                    <td style="padding: 12px 16px; font-size: 14px; font-weight: 500; color: #111827;{{ !$loop->last ? ' border-bottom: 1px solid #F3F4F6;' : '' }}">{{ $employee['name'] }}</td>
                                    <td style="padding: 12px 16px; font-size: 14px; font-weight: 600; color: #B45309; text-align: right;{{ !$loop->last ? ' border-bottom: 1px solid #F3F4F6;' : '' }}">{{ number_format($employee['hours'], 1) }}h</td>
                                </tr>
                                @endforeach
                            </table>
                        </td>
                    </tr>
                    @endif

                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 32px 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <a href="{{ $dashboardUrl }}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px;">View Full Report</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 20px 40px; background-color: #F9FAFB; border-top: 1px solid #E5E7EB;">
                            <p style="margin: 0; font-size: 12px; color: #9CA3AF; text-align: center;">
                                You received this email because you subscribed to weekly reports on TrackFlow.
                                <br>To unsubscribe, visit your <a href="{{ $dashboardUrl }}/settings" style="color: #D97706; text-decoration: underline;">notification settings</a>.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
