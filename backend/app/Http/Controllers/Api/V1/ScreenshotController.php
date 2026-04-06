<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Screenshot;
use App\Jobs\ProcessScreenshotJob;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ScreenshotController extends Controller
{
    // Use configured disk — 's3' in production with AWS, 'public' for local storage
    private function disk(): string
    {
        return config('filesystems.disks.s3.key') ? 's3' : 'public';
    }

    // SS-01: Upload screenshot from agent
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|image|mimes:jpeg,jpg,png|max:5120',
            'time_entry_id' => 'required|uuid',
            'captured_at' => 'required|date',
            'activity_score' => 'sometimes|integer|min:0|max:100',
            'app_name' => 'sometimes|string|max:255',
            'window_title' => 'sometimes|string|max:500',
        ]);

        $user = $request->user();

        // Validate that time_entry_id belongs to the authenticated user
        $timeEntry = $user->timeEntries()->where('id', $request->time_entry_id)->firstOrFail();

        // Validate the time entry is currently active (running or ended less than 5 minutes ago)
        $isActive = $timeEntry->ended_at === null
            || $timeEntry->ended_at->greaterThan(now()->subMinutes(5));

        if (!$isActive) {
            return response()->json([
                'message' => 'Screenshots can only be uploaded to active time entries.',
                'errors' => ['time_entry_id' => ['The time entry is no longer active.']],
            ], 422);
        }

        $org = $user->organization;
        // Use captured_at date for storage path so screenshots are organized by capture date, not upload date
        $date = $request->captured_at
            ? \Carbon\Carbon::parse($request->captured_at)->format('Y-m-d')
            : now()->format('Y-m-d');
        $filename = time() . '_' . Str::random(8) . '.jpg';
        $storageKey = "{$org->id}/{$user->id}/{$date}/{$filename}";

        $disk = $this->disk();

        // Store the file
        $request->file('file')->storeAs(
            "screenshots/{$org->id}/{$user->id}/{$date}",
            $filename,
            $disk
        );

        // Get image dimensions
        $imageSize = getimagesize($request->file('file')->getPathname());
        $width = $imageSize[0] ?? 1920;
        $height = $imageSize[1] ?? 1080;

        $screenshot = Screenshot::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $request->time_entry_id,
            's3_key' => $storageKey,
            'captured_at' => $request->captured_at,
            'activity_score_at_capture' => $request->input('activity_score'),
            'app_name' => $request->input('app_name'),
            'window_title' => $request->input('window_title'),
            'is_blurred' => $org->getSetting('blur_screenshots', false),
            'width' => $width,
            'height' => $height,
        ]);

        // Only dispatch processing job if Intervention Image is available
        try {
            ProcessScreenshotJob::dispatch($screenshot);
        } catch (\Exception $e) {
            // Processing is optional — screenshot is already saved
        }

        return response()->json(['screenshot' => $screenshot], 201);
    }

    // SS-02: List screenshots with filters
    public function index(Request $request): JsonResponse
    {
        $query = Screenshot::query()
            ->where('organization_id', $request->user()->organization_id)
            ->with(['user', 'timeEntry', 'timeEntry.project']);

        // Employees see only own screenshots
        if ($request->user()->isEmployee()) {
            $query->where('user_id', $request->user()->id);
        } elseif ($request->has('user_id')) {
            $request->user()->organization->users()->findOrFail($request->user_id);
            $query->where('user_id', $request->user_id);
        }

        if ($request->has('date_from') && $request->has('date_to')) {
            $tz = $request->user()->getTimezoneForDates();
            [$dateFromUtc, $dateToUtc] = TimezoneAwareDateRange::toUtcBounds(
                $request->date_from,
                $request->date_to,
                $tz
            );
            $query->where('captured_at', '>=', $dateFromUtc)->where('captured_at', '<', $dateToUtc);
        }
        if ($request->has('time_entry_id')) {
            $query->where('time_entry_id', $request->time_entry_id);
        }
        if ($request->has('time_type')) {
            $request->validate(['time_type' => 'string|in:tracked,manual,idle']);
            $query->whereHas('timeEntry', fn ($q) => $q->where('type', $request->time_type));
        }
        if ($request->has('project_id')) {
            $query->whereHas('timeEntry', fn ($q) => $q->where('project_id', $request->project_id));
        }

        $screenshots = $query->orderBy('captured_at', 'desc')->paginate(
            min((int) $request->input('per_page', 50), 100)
        );

        // Pre-load activity logs closest to each screenshot's capture time (within 10 min window).
        // We batch-query all relevant activity logs to avoid N+1.
        $screenshotIds = $screenshots->getCollection()->pluck('id')->all();
        $screenshotMap = $screenshots->getCollection()->keyBy('id');

        // Build a map of time_entry_id => captured_at for lookup
        $activityData = [];
        if (count($screenshotIds) > 0) {
            // For each screenshot, find the closest activity log within its time entry
            foreach ($screenshots->getCollection() as $ss) {
                if (!$ss->time_entry_id || !$ss->captured_at) continue;
                $log = ActivityLog::where('time_entry_id', $ss->time_entry_id)
                    ->where('organization_id', $ss->organization_id)
                    ->whereBetween('logged_at', [
                        $ss->captured_at->copy()->subMinutes(10),
                        $ss->captured_at->copy()->addMinutes(10),
                    ])
                    ->orderByRaw(
                        DB::connection()->getDriverName() === 'sqlite'
                            ? 'ABS(CAST((julianday(logged_at) - julianday(?)) * 86400 AS INTEGER))'
                            : 'ABS(EXTRACT(EPOCH FROM (logged_at - ?)))',
                        [$ss->captured_at]
                    )
                    ->first();
                if ($log) {
                    $activityData[$ss->id] = $log;
                }
            }
        }

        // Add URLs for viewing — serve through HMAC-signed API endpoint for reliability
        // (avoids CORS, expired S3 signed URLs, and storage driver mismatches)
        $screenshots->getCollection()->transform(function ($screenshot) use ($activityData) {
            $screenshot->thumbnail_url = $this->getSignedFileUrl($screenshot->id, 'thumbnail');
            $screenshot->url = $this->getSignedFileUrl($screenshot->id, 'display');
            $screenshot->original_url = $this->getSignedFileUrl($screenshot->id, 'original');
            $screenshot->user_name = $screenshot->user?->name ?? 'Unknown';
            $screenshot->user_avatar_color = substr(md5($screenshot->user_id ?? ''), 0, 6);
            // Prefer point-in-time score captured with the screenshot (Hubstaff-style),
            // fall back to the time entry's overall score for older screenshots
            $screenshot->activity_score = $screenshot->activity_score_at_capture
                ?? $screenshot->timeEntry?->activity_score
                ?? 0;
            $screenshot->project_name = $screenshot->timeEntry?->project?->name ?? null;
            $screenshot->project_id = $screenshot->timeEntry?->project_id ?? null;
            $screenshot->app_name = $screenshot->app_name;
            $screenshot->window_title = $screenshot->window_title;

            // Attach keyboard/mouse event counts from closest activity log
            $log = $activityData[$screenshot->id] ?? null;
            $screenshot->keyboard_events = $log?->keyboard_events ?? null;
            $screenshot->mouse_events = $log?->mouse_events ?? null;

            return $screenshot;
        });

        return response()->json($screenshots);
    }

    // SS-03: Delete screenshot
    public function destroy(Request $request, string $id): JsonResponse
    {
        $screenshot = Screenshot::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
        $this->authorize('delete', $screenshot);

        $disk = $this->disk();
        $filesToDelete = ["screenshots/{$screenshot->s3_key}"];
        if ($screenshot->thumbnail_key) {
            $filesToDelete[] = "screenshots/{$screenshot->thumbnail_key}";
        }
        if ($screenshot->display_key) {
            $filesToDelete[] = "screenshots/{$screenshot->display_key}";
        }
        Storage::disk($disk)->delete($filesToDelete);

        $screenshot->delete();
        return response()->json(['message' => 'Screenshot deleted.']);
    }

    // SS-04: Serve screenshot file via signed URL (no auth required, HMAC-verified)
    // This avoids CORS, expired S3 signed URLs, and storage driver issues.
    // The signature is generated by the backend when listing screenshots.
    public function show(Request $request, string $id): \Symfony\Component\HttpFoundation\Response
    {
        // Verify the HMAC signature to prevent unauthorized access
        $signature = $request->query('sig', '');
        $expires = (int) $request->query('expires', 0);
        $variant = $request->query('variant', 'display');

        if (!$signature || !$expires || $expires < time()) {
            abort(403, 'Invalid or expired signature.');
        }

        $expectedSig = self::generateSignature($id, $variant, $expires);
        if (!hash_equals($expectedSig, $signature)) {
            abort(403, 'Invalid signature.');
        }

        $screenshot = Screenshot::findOrFail($id);

        // Determine which variant to serve
        $storageKey = match ($variant) {
            'thumbnail' => $screenshot->thumbnail_key ?? $screenshot->s3_key,
            'original' => $screenshot->s3_key,
            default => $screenshot->display_key ?? $screenshot->s3_key,
        };

        $disk = $this->disk();
        $fullPath = "screenshots/{$storageKey}";

        if (!Storage::disk($disk)->exists($fullPath)) {
            abort(404, 'Screenshot file not found.');
        }

        $stream = Storage::disk($disk)->readStream($fullPath);
        $mimeType = Storage::disk($disk)->mimeType($fullPath) ?: 'image/jpeg';
        $size = Storage::disk($disk)->size($fullPath);

        return response()->stream(
            function () use ($stream) {
                fpassthru($stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }
            },
            200,
            [
                'Content-Type' => $mimeType,
                'Content-Length' => $size,
                'Cache-Control' => 'private, max-age=3600', // 1h browser cache
                'Content-Disposition' => 'inline',
            ]
        );
    }

    /**
     * Generate an HMAC signature for a screenshot file URL.
     * Uses APP_KEY as the secret so no additional config is needed.
     */
    private static function generateSignature(string $screenshotId, string $variant, int $expires): string
    {
        $payload = "{$screenshotId}:{$variant}:{$expires}";
        return hash_hmac('sha256', $payload, config('app.key'));
    }

    /**
     * Build a signed URL for serving a screenshot file through the API.
     * The URL is valid for the given TTL (default 2 hours).
     */
    private function getSignedFileUrl(string $screenshotId, string $variant = 'display', int $ttlSeconds = 7200): string
    {
        $expires = time() + $ttlSeconds;
        $sig = self::generateSignature($screenshotId, $variant, $expires);
        return url("/api/v1/screenshots/{$screenshotId}/file?" . http_build_query([
            'variant' => $variant,
            'expires' => $expires,
            'sig' => $sig,
        ]));
    }

    // SS-05: Issue signed cookies for gallery
    public function signedCookies(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Signed cookies issued.',
            'expires_at' => now()->addHours(2)->toISOString(),
        ]);
    }

}
