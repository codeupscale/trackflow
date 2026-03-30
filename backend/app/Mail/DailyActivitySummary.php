<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class DailyActivitySummary extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $employeeName,
        public string $date,
        public int $totalSeconds,
        public int $trackedSeconds,
        public int $idleSeconds,
        public int $activityPercentage,
        public array $projects,
        public string $organizationName,
        public string $dashboardUrl,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Your Daily Activity Summary — {$this->date}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.daily-activity-summary',
            with: [
                'employee_name' => $this->employeeName,
                'date' => $this->date,
                'total_seconds' => $this->totalSeconds,
                'tracked_seconds' => $this->trackedSeconds,
                'idle_seconds' => $this->idleSeconds,
                'activity_percentage' => $this->activityPercentage,
                'projects' => $this->projects,
                'organization_name' => $this->organizationName,
                'dashboard_url' => $this->dashboardUrl,
                'total_hours' => round($this->totalSeconds / 3600, 1),
                'tracked_hours' => round($this->trackedSeconds / 3600, 1),
                'idle_hours' => round($this->idleSeconds / 3600, 1),
            ],
        );
    }
}
