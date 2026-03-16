<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">Idle Activity Alert</h2>
    <p>Hi {{ $manager_name }},</p>
    <p><strong>{{ $employee_name }}</strong> has been idle for more than <strong>{{ $idle_minutes }} minutes</strong>.</p>
    <p>Idle since: {{ $idle_since }}</p>
    <p>You can check their activity on the <a href="{{ config('app.frontend_url', config('app.url')) }}/dashboard" style="color: #2563eb;">TrackFlow Dashboard</a>.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px;">TrackFlow — Workforce Monitoring Platform</p>
</body>
</html>
