<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class FlushAgentQueueJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 120;

    public function __construct(
        public string $userId,
        public string $organizationId,
        public array $logs
    ) {
        $this->onQueue('high');
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function handle(): void
    {
        $inserted = 0;

        foreach ($this->logs as $logData) {
            $validator = Validator::make($logData, [
                'time_entry_id' => 'required|uuid',
                'logged_at' => 'required|date',
                'keyboard_events' => 'integer|min:0',
                'mouse_events' => 'integer|min:0',
                'active_app' => 'nullable|string|max:255',
                'active_window_title' => 'nullable|string|max:512',
                'active_url' => 'nullable|string|max:1024',
            ]);

            if ($validator->fails()) {
                Log::warning('FlushAgentQueueJob: skipping invalid log entry', [
                    'errors' => $validator->errors()->toArray(),
                ]);
                continue;
            }

            ActivityLog::create([
                'organization_id' => $this->organizationId,
                'user_id' => $this->userId,
                'time_entry_id' => $logData['time_entry_id'],
                'logged_at' => $logData['logged_at'],
                'keyboard_events' => $logData['keyboard_events'] ?? 0,
                'mouse_events' => $logData['mouse_events'] ?? 0,
                'active_app' => $logData['active_app'] ?? null,
                'active_window_title' => $logData['active_window_title'] ?? null,
                'active_url' => $logData['active_url'] ?? null,
            ]);
            $inserted++;
        }

        Log::info("FlushAgentQueueJob completed", [
            'user_id' => $this->userId,
            'inserted' => $inserted,
            'total' => count($this->logs),
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('FlushAgentQueueJob failed', [
            'user_id' => $this->userId,
            'log_count' => count($this->logs),
            'error' => $exception->getMessage(),
        ]);
    }
}
