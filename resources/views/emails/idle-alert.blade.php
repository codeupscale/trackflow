<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Employee Idle Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f7; color: #333333;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7; padding: 40px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #dc2626; padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">TrackFlow</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h2 style="margin: 0 0 20px; font-size: 20px; color: #1a1a2e;">Idle Alert</h2>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                Hi {{ $manager_name }},
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                <strong>{{ $employee_name }}</strong> has been idle for more than
                                <strong>{{ $idle_minutes }} minutes</strong> while their timer is still running.
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                <strong>Idle since:</strong> {{ $idle_since }}
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                You may want to check in with the employee or review their time entries.
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
