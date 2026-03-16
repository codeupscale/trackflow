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

    public function handle(): void
    {
        $s3Key = "screenshots/{$this->screenshot->s3_key}";

        try {
            // Check if file exists
            if (!Storage::disk('s3')->exists($s3Key)) {
                return;
            }

            // Get file contents
            $contents = Storage::disk('s3')->get($s3Key);

            // Use Intervention Image if available to resize
            if (class_exists(\Intervention\Image\ImageManager::class)) {
                $manager = new \Intervention\Image\ImageManager(
                    new \Intervention\Image\Drivers\Gd\Driver()
                );
                $image = $manager->read($contents);

                // Resize to max 1280px width while maintaining aspect ratio
                if ($image->width() > 1280) {
                    $image->scaleDown(width: 1280);
                }

                // Blur if org setting enabled
                if ($this->screenshot->is_blurred) {
                    $image->blur(15);
                }

                $processed = $image->toJpeg(quality: 80)->toString();

                // Overwrite with processed version
                Storage::disk('s3')->put($s3Key, $processed);
            }

            $this->screenshot->update(['processed_at' => now()]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("ProcessScreenshotJob S3 error for screenshot {$this->screenshot->id}", [
                'error' => $e->getMessage(),
                's3_key' => $s3Key,
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
