<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class WeeklyReportMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $userName,
        public string $orgName,
        public string $weekStart,
        public string $weekEnd,
        public float $totalHours,
        public array $topEmployees,
        public float $teamActivity,
        public int $screenshotCount,
        public int $pendingLeaveRequests,
        public string $dashboardUrl
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "{$this->orgName} — Weekly Summary ({$this->weekStart} to {$this->weekEnd})",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.weekly-report',
            text: 'emails.weekly-report-text',
        );
    }
}
