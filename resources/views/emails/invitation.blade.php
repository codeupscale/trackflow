<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You're Invited to TrackFlow</title>
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
                            <h2 style="margin: 0 0 20px; font-size: 20px; color: #1a1a2e;">You've Been Invited!</h2>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                Hi {{ $invitee_name ?? 'there' }},
                            </p>
                            <p style="margin: 0 0 16px; line-height: 1.6;">
                                {{ $inviter_name }} has invited you to join <strong>{{ $organization_name }}</strong> on TrackFlow as a <strong>{{ $role }}</strong>.
                            </p>
                            <p style="margin: 0 0 30px; line-height: 1.6;">
                                Click the button below to accept the invitation and set up your account.
                            </p>
                            <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                                <tr>
                                    <td style="background-color: #4f46e5; border-radius: 6px; text-align: center;">
                                        <a href="{{ $invitation_url }}" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px;">Accept Invitation</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 30px 0 0; line-height: 1.6; font-size: 14px; color: #666666;">
                                This invitation will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.
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
