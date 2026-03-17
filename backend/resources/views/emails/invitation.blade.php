<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2563eb;">You're Invited to TrackFlow</h2>
    <p>Hi there,</p>
    <p><strong>{{ $invited_by }}</strong> has invited you to join <strong>{{ $organization_name }}</strong> on TrackFlow as a <strong>{{ $role }}</strong>.</p>
    <p style="margin: 30px 0;">
        <a href="{{ $invitation_url }}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Invitation</a>
    </p>
    <p style="color: #666; font-size: 14px;">This invitation expires on {{ $expires_at }}.</p>
    <p style="color: #666; font-size: 14px;">If you didn't expect this invitation, you can safely ignore this email.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px;">TrackFlow — Workforce Monitoring Platform</p>
    <p style="color: #999; font-size: 12px; margin-top: 20px;">
        <a href="{{ $unsubscribe_url ?? '#' }}" style="color: #999; text-decoration: none;">Unsubscribe from notifications</a>
    </p>
</body>
</html>
