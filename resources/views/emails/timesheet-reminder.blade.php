<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Timesheet Reminder</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f7; color: #333333;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7; padding: 40px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #4f46e5; padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">TrackFlow</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h2 style="margin: 0 0 20px; font-size: 20px; color: #1a1a2e;">Timesheet Reminder</h2>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                Hi {{ $employee_name }},
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                This is a friendly reminder that your timesheet for the week of
                                <strong>{{ $week_start }} &ndash; {{ $week_end }}</strong>
                                has not been submitted yet.
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                Please review your time entries and submit your timesheet at your earliest convenience to ensure accurate records for <strong>{{ $organization_name }}</strong>.
                            </p>
                            <p style="margin: 0 0 30px; line-height: 1.6;">
                                If you have already submitted your timesheet, please disregard this reminder.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 20px 30px; text-align: center; font-size: 12px; color: #999999; border-top: 1px solid #eeeeee;">
                            <p style="margin: 0;">&copy; {{ date('Y') }} TrackFlow. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
