<?php

namespace App\Notifications;

use App\Models\Payslip;
use App\Notifications\Channels\SafeBroadcastChannel;

/**
 * A payslip was verified and released. Sent to the employee it belongs to.
 *
 * This is the one notification that also goes by MAIL: a payslip is the thing
 * people check from their phone, on a day they may not open the dashboard at
 * all. The mail deliberately carries no figures — it says a payslip is ready
 * and links to it, so salary never sits in an inbox in plain text.
 */
class PayslipSent extends TrackflowNotification
{
    public function __construct(
        private readonly Payslip $payslip,
        private readonly string $periodName,
    ) {}

    public function category(): string
    {
        return 'payroll.payslip_sent';
    }

    public function via(object $notifiable): array
    {
        return $this->respectingPreferences($notifiable, ['database', SafeBroadcastChannel::class, 'mail']);
    }

    public function title(object $notifiable): string
    {
        return "Your payslip for {$this->periodName} is ready";
    }

    public function body(object $notifiable): string
    {
        return 'It has been reviewed and released. Open it to view or download the PDF.';
    }

    public function url(object $notifiable): string
    {
        return '/hr/payroll/my-payslips';
    }

    public function meta(object $notifiable): array
    {
        return [
            'payslip_id' => $this->payslip->id,
            'period_name' => $this->periodName,
        ];
    }

    public function toMail(object $notifiable): \Illuminate\Notifications\Messages\MailMessage
    {
        return (new \Illuminate\Notifications\Messages\MailMessage)
            ->subject("Your payslip for {$this->periodName} is ready")
            ->greeting("Hi {$notifiable->name},")
            ->line("Your payslip for {$this->periodName} has been reviewed and is now available.")
            ->action('View payslip', rtrim(config('app.frontend_url', config('app.url')), '/') . '/hr/payroll/my-payslips')
            ->line('If you have any questions about it, reply to your HR or finance contact.');
    }
}
