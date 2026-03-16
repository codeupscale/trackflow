<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2563eb;">Timesheet Reminder</h2>
    <p>Hi {{ $employee_name }},</p>
    <p>This is a friendly reminder to submit your timesheet for the week of <strong>{{ $week_start }}</strong>.</p>
    <p style="margin: 30px 0;">
        <a href="{{ config('app.frontend_url', config('app.url')) }}/time" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Submit Timesheet</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px;">TrackFlow — Workforce Monitoring Platform</p>
</body>
</html>
