<?php

namespace App\Jobs;

use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

class ExportUserDataJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(
        private User $user,
    ) {
        $this->queue = 'default';
    }

    public function handle(): void
    {
        $data = [
            'profile' => [
                'name' => $this->user->name,
                'email' => $this->user->email,
                'role' => $this->user->role,
                'timezone' => $this->user->timezone,
                'created_at' => $this->user->created_at?->toISOString(),
            ],
            'time_entries' => $this->user->timeEntries()
                ->with(['project:id,name', 'task:id,name'])
                ->get()
                ->map(fn ($entry) => [
                    'started_at' => $entry->started_at?->toISOString(),
                    'ended_at' => $entry->ended_at?->toISOString(),
                    'duration_seconds' => $entry->duration_seconds,
                    'project' => $entry->project?->name,
                    'task' => $entry->task?->name,
                    'notes' => $entry->notes,
                    'type' => $entry->type,
                ]),
            'screenshots_metadata' => $this->user->screenshots()
                ->get()
                ->map(fn ($ss) => [
                    'captured_at' => $ss->captured_at?->toISOString(),
                    'activity_score' => $ss->activity_score,
                ]),
            'teams' => $this->user->teams->pluck('name'),
            'exported_at' => now()->toISOString(),
        ];

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        $filename = "exports/{$this->user->id}/data-export-" . now()->format('Y-m-d-His') . '.json';

        Storage::disk('local')->put($filename, $json);

        Log::info('user.data_exported', [
            'user_id' => $this->user->id,
            'file' => $filename,
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('user.data_export_failed', [
            'user_id' => $this->user->id,
            'error' => $exception->getMessage(),
        ]);
    }
}
