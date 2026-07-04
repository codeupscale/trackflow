<?php

namespace App\Support;

use App\Models\Screenshot;
use Illuminate\Support\Facades\Storage;

/**
 * Single source of truth for screenshot variant URL generation.
 *
 * Used by both ScreenshotController (list/show) and the ScreenshotUploaded
 * broadcast event so the signed-URL formula never drifts between the two.
 * The HMAC signature MUST match ScreenshotController::show() verification.
 */
class ScreenshotUrl
{
    public const DEFAULT_TTL = 86400; // 24h

    public static function disk(): string
    {
        return config('filesystems.default');
    }

    public static function generateSignature(string $screenshotId, string $variant, int $expires): string
    {
        return hash_hmac('sha256', "{$screenshotId}:{$variant}:{$expires}", config('app.key'));
    }

    /**
     * Fallback signed API URL (local/non-S3 disks) that routes through
     * ScreenshotController::show() and is verified via generateSignature().
     */
    public static function signedFileUrl(string $screenshotId, string $variant = 'display', int $ttlSeconds = self::DEFAULT_TTL): string
    {
        $expires = time() + $ttlSeconds;
        $sig = self::generateSignature($screenshotId, $variant, $expires);

        return url("/api/v1/screenshots/{$screenshotId}/file?" . http_build_query([
            'variant' => $variant,
            'expires' => $expires,
            'sig'     => $sig,
        ]));
    }

    /**
     * Presigned S3 GET URL for a screenshot variant, falling back to the
     * signed API endpoint when the disk cannot produce a temporary URL.
     *
     * @param  string  $variant  thumbnail|display|original
     */
    public static function variantUrl(Screenshot $screenshot, string $variant, int $ttlSeconds = self::DEFAULT_TTL): string
    {
        $key = match ($variant) {
            'thumbnail' => $screenshot->thumbnail_key ?? $screenshot->s3_key,
            'original'  => $screenshot->s3_key,
            default     => $screenshot->display_key ?? $screenshot->s3_key,
        };

        try {
            return Storage::disk(self::disk())->temporaryUrl(
                "screenshots/{$key}",
                now()->addSeconds($ttlSeconds)
            );
        } catch (\Exception) {
            return self::signedFileUrl($screenshot->id, $variant, $ttlSeconds);
        }
    }
}
