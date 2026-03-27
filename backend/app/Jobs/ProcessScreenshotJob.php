<?php

namespace App\Jobs;

use App\Models\Screenshot;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ProcessScreenshotJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;

    public function __construct(public Screenshot $screenshot)
    {
        $this->onQueue('screenshots');
    }

    private function disk(): string
    {
        return config('filesystems.disks.s3.key') ? 's3' : 'public';
    }

    public function handle(): void
    {
        // Idempotency guard — skip if already processed
        if ($this->screenshot->processed_at !== null) {
            return;
        }

        $disk = $this->disk();
        $storageKey = "screenshots/{$this->screenshot->s3_key}";

        try {
            if (!Storage::disk($disk)->exists($storageKey)) {
                Log::warning('ProcessScreenshotJob: source file not found', [
                    'screenshot_id' => $this->screenshot->id,
                    'key' => $storageKey,
                ]);
                return;
            }

            if (!class_exists(\Intervention\Image\ImageManager::class)) {
                Log::warning('ProcessScreenshotJob: Intervention Image not available, skipping thumbnail generation', [
                    'screenshot_id' => $this->screenshot->id,
                ]);
                $this->screenshot->update(['processed_at' => now()]);
                return;
            }

            $contents = Storage::disk($disk)->get($storageKey);
            $manager = new \Intervention\Image\ImageManager(
                new \Intervention\Image\Drivers\Gd\Driver()
            );

            // Derive storage keys for thumbnail and display variants
            $s3Key = $this->screenshot->s3_key;
            $baseKey = preg_replace('/\.[^.]+$/', '', $s3Key);

            $thumbnailKey = $baseKey . '_thumb.jpg';
            $displayKey = $baseKey . '_display.jpg';

            // Generate thumbnail: 320px wide, JPEG quality 70
            $thumbImage = $manager->read($contents);
            $thumbImage->scaleDown(width: 320);
            $thumbData = $thumbImage->toJpeg(quality: 70)->toString();
            Storage::disk($disk)->put("screenshots/{$thumbnailKey}", $thumbData);

            // Generate display version: 1280px wide, JPEG quality 80, blur if needed
            $displayImage = $manager->read($contents);
            if ($displayImage->width() > 1280) {
                $displayImage->scaleDown(width: 1280);
            }
            if ($this->screenshot->is_blurred) {
                $displayImage->blur(15);
            }
            $displayData = $displayImage->toJpeg(quality: 80)->toString();
            Storage::disk($disk)->put("screenshots/{$displayKey}", $displayData);

            // Update model with generated keys
            $this->screenshot->update([
                'thumbnail_key' => $thumbnailKey,
                'display_key' => $displayKey,
                'processed_at' => now(),
            ]);
        } catch (\Exception $e) {
            Log::error('ProcessScreenshotJob error', [
                'screenshot_id' => $this->screenshot->id,
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
        Log::critical('ProcessScreenshotJob failed permanently', [
            'screenshot_id' => $this->screenshot->id,
            'error' => $exception->getMessage(),
        ]);
    }
}
