<?php

namespace App\Jobs;

use App\Models\Screenshot;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;

class ProcessScreenshotJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 60;

    public function __construct(public Screenshot $screenshot)
    {
        $this->onQueue('high');
    }

    private function disk(): string
    {
        return config('filesystems.disks.s3.key') ? 's3' : 'public';
    }

    public function handle(): void
    {
        $disk = $this->disk();
        $storageKey = "screenshots/{$this->screenshot->s3_key}";

        try {
            if (!Storage::disk($disk)->exists($storageKey)) {
                return;
            }

            // Use Intervention Image if available to resize
            if (class_exists(\Intervention\Image\ImageManager::class)) {
                $contents = Storage::disk($disk)->get($storageKey);
                $manager = new \Intervention\Image\ImageManager(
                    new \Intervention\Image\Drivers\Gd\Driver()
                );
                $image = $manager->read($contents);

                if ($image->width() > 1280) {
                    $image->scaleDown(width: 1280);
                }

                if ($this->screenshot->is_blurred) {
                    $image->blur(15);
                }

                $processed = $image->toJpeg(quality: 80)->toString();
                Storage::disk($disk)->put($storageKey, $processed);
            }

            $this->screenshot->update(['processed_at' => now()]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("ProcessScreenshotJob error for screenshot {$this->screenshot->id}", [
                'error' => $e->getMessage(),
                'key' => $storageKey,
            ]);
            throw $e;
        }
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        \Illuminate\Support\Facades\Log::critical("ProcessScreenshotJob failed for screenshot {$this->screenshot->id}", [
            'error' => $exception->getMessage(),
        ]);
    }
}
