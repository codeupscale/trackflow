<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;

class SendEmailNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 5;
    public $timeout = 30;

    public function __construct(
        public string $to,
        public string $subject,
        public string $view,
        public array $data = []
    ) {
        $this->onQueue('high');
    }

    public function handle(): void
    {
        Mail::send($this->view, $this->data, function ($message) {
            $message->to($this->to)->subject($this->subject);
        });
    }

    public function backoff(): array
    {
        return [30, 60, 300, 600, 900];
    }

    public function failed(\Throwable $exception): void
    {
        \Illuminate\Support\Facades\Log::critical("SendEmailNotificationJob failed", [
            'to' => $this->to,
            'subject' => $this->subject,
            'error' => $exception->getMessage(),
        ]);
    }
}
