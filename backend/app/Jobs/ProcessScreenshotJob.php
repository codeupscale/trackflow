<?php

namespace App\Jobs;

use App\Events\ScreenshotUploaded;
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
    public int $timeout = 120;

    public function __construct(public Screenshot $screenshot)
    {
        $this->onQueue('screenshots');
    }

    private function disk(): string
    {
        return config('filesystems.default');
    }

    public function handle(): void
    {
        if ($this->screenshot->processed_at !== null) {
            return;
        }

        $disk = $this->disk();
        $storageKey = "screenshots/{$this->screenshot->s3_key}";

        if (!Storage::disk($disk)->exists($storageKey)) {
            Log::warning('ProcessScreenshotJob: source file not found', [
                'screenshot_id' => $this->screenshot->id,
                'key'           => $storageKey,
            ]);
            return;
        }

        // Stream from S3 into a local temp file — never holds full image in PHP string memory.
        // GD would require loading the entire file as a string (75–100 MB peak for 2 workers).
        // Imagick reads from file path and manages its own memory pool.
        $tmpInput = tempnam(sys_get_temp_dir(), 'ss_in_');
        try {
            $stream = Storage::disk($disk)->readStream($storageKey);
            $out = fopen($tmpInput, 'wb');
            stream_copy_to_stream($stream, $out);
            fclose($out);
            if (is_resource($stream)) fclose($stream);

            [$thumbnailData, $displayData] = $this->processWithImagick($tmpInput);

            $baseKey      = preg_replace('/\.[^.]+$/', '', $this->screenshot->s3_key);
            $thumbnailKey = $baseKey . '_thumb.jpg';
            $displayKey   = $baseKey . '_display.jpg';

            Storage::disk($disk)->put("screenshots/{$thumbnailKey}", $thumbnailData);
            Storage::disk($disk)->put("screenshots/{$displayKey}", $displayData);

            $this->screenshot->update([
                'thumbnail_key' => $thumbnailKey,
                'display_key'   => $displayKey,
                'processed_at'  => now(),
            ]);
        } catch (\Exception $e) {
            Log::error('ProcessScreenshotJob error', [
                'screenshot_id' => $this->screenshot->id,
                'error'         => $e->getMessage(),
            ]);
            throw $e;
        } finally {
            if (file_exists($tmpInput)) @unlink($tmpInput);
        }

        // Broadcast AFTER processing is fully committed. Isolated from the try
        // above and swallowed on failure: a momentarily-unreachable Reverb must
        // never fail or retry the already-persisted job (the processed_at guard
        // would early-return the retry and silently drop the event anyway). The
        // web self-heals via its focus/interval refetch through the REST index.
        try {
            ScreenshotUploaded::dispatch($this->screenshot->refresh());
        } catch (\Throwable $e) {
            Log::warning('ProcessScreenshotJob: realtime broadcast failed (processing already committed)', [
                'screenshot_id' => $this->screenshot->id,
                'error'         => $e->getMessage(),
            ]);
        }
    }

    /**
     * Process thumbnail (320px) and display (1280px) variants using Imagick.
     * Falls back to Intervention/GD if Imagick is not loaded.
     * Returns [thumbnailBlob, displayBlob].
     */
    private function processWithImagick(string $filePath): array
    {
        if (extension_loaded('imagick')) {
            return $this->imagickProcess($filePath);
        }

        if (class_exists(\Intervention\Image\ImageManager::class)) {
            return $this->interventionProcess($filePath);
        }

        // No image library — mark processed so the job doesn't retry forever
        $raw = file_get_contents($filePath);
        return [$raw, $raw];
    }

    private function imagickProcess(string $filePath): array
    {
        // Thumbnail — 320px wide, JPEG quality 70
        $thumb = new \Imagick($filePath);
        $thumb->setImageCompressionQuality(70);
        $thumb->stripImage(); // remove EXIF to shrink size
        $thumb->thumbnailImage(320, 0); // 0 = auto height preserving ratio
        $thumb->setImageFormat('jpeg');
        $thumbnailData = $thumb->getImageBlob();
        $thumb->destroy();

        // Display — 1280px wide max, JPEG quality 80, optional blur
        $display = new \Imagick($filePath);
        $display->setImageCompressionQuality(80);
        $display->stripImage();
        if ($display->getImageWidth() > 1280) {
            $display->thumbnailImage(1280, 0);
        }
        if ($this->screenshot->is_blurred) {
            $display->blurImage(0, 8); // sigma=8 gives a strong privacy blur
        }
        $display->setImageFormat('jpeg');
        $displayData = $display->getImageBlob();
        $display->destroy();

        return [$thumbnailData, $displayData];
    }

    private function interventionProcess(string $filePath): array
    {
        $manager = new \Intervention\Image\ImageManager(
            new \Intervention\Image\Drivers\Gd\Driver()
        );

        $thumbImage = $manager->read($filePath);
        $thumbImage->scaleDown(width: 320);
        $thumbnailData = $thumbImage->toJpeg(quality: 70)->toString();

        $displayImage = $manager->read($filePath);
        if ($displayImage->width() > 1280) {
            $displayImage->scaleDown(width: 1280);
        }
        if ($this->screenshot->is_blurred) {
            $displayImage->blur(15);
        }
        $displayData = $displayImage->toJpeg(quality: 80)->toString();

        return [$thumbnailData, $displayData];
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical('ProcessScreenshotJob failed permanently', [
            'screenshot_id' => $this->screenshot->id,
            'error'         => $exception->getMessage(),
        ]);
    }
}
