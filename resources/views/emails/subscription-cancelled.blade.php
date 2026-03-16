<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">Subscription Cancelled</h2>
    <p>Hi {{ $name }},</p>
    <p>Your TrackFlow subscription has been cancelled. You have a <strong>30-day grace period</strong> (until {{ $grace_period_ends }}) to resubscribe before your data is affected.</p>
    <p>During this period, you'll retain access to all features on a trial basis.</p>
    <p style="margin: 30px 0;">
        <a href="{{ config('app.frontend_url', config('app.url')) }}/settings/billing" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Resubscribe</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px;">TrackFlow — Workforce Monitoring Platform</p>
</body>
</html>
