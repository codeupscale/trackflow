<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Screenshot;
use App\Jobs\ProcessScreenshotJob;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ScreenshotController extends Controller
{
    private function disk(): string
    {
        return config('filesystems.default');
    }

    // SS-01a: Issue presigned S3 PUT URL — desktop uploads directly to S3 (no API transit)
    public function presign(Request $request): JsonResponse
    {
        $request->validate([
            'time_entry_id'   => 'required|uuid',
            'captured_at'     => 'required|date',
            'file_size'       => 'required|integer|min:1|max:10485760', // 10 MB cap
            'idempotency_key' => 'sometimes|string|max:64',
            'display_index'   => 'sometimes|integer|min:0',
            'display_count'   => 'sometimes|integer|min:1',
            'app_name'        => 'sometimes|string|max:255',
            'window_title'    => 'sometimes|string|max:500',
            'activity_score'  => 'sometimes|integer|min:0|max:100',
            'width'           => 'sometimes|integer|min:1',
            'height'          => 'sometimes|integer|min:1',
        ]);

        $user = $request->user();
        $timeEntry = $user->timeEntries()->where('id', $request->time_entry_id)->firstOrFail();

        $isActive = $timeEntry->ended_at === null
            || $timeEntry->ended_at->greaterThan(now()->subMinutes(5));

        if (!$isActive) {
            return response()->json([
                'message' => 'Screenshots can only be uploaded to active time entries.',
                'errors'  => ['time_entry_id' => ['The time entry is no longer active.']],
            ], 422);
        }

        // Idempotency: return existing pending screenshot if key already seen
        if ($request->filled('idempotency_key')) {
            $existing = Screenshot::where('organization_id', $user->organization_id)
                ->where('idempotency_key', $request->idempotency_key)
                ->where('status', 'pending')
                ->first();
            if ($existing) {
                $uploadUrl = Storage::disk($this->disk())->temporaryUploadUrl(
                    "screenshots/{$existing->s3_key}",
                    now()->addMinutes(15),
                    ['Content-Type' => 'image/jpeg']
                );
                return response()->json(['screenshot_id' => $existing->id, 'upload_url' => $uploadUrl]);
            }
        }

        $org = $user->organization;
        $date = \Carbon\Carbon::parse($request->captured_at)->format('Y-m-d');
        $filename = time() . '_' . Str::random(8) . '.jpg';
        $s3Key = "{$org->id}/{$user->id}/{$date}/{$filename}";

        $screenshot = Screenshot::create([
            'organization_id'         => $org->id,
            'user_id'                 => $user->id,
            'time_entry_id'           => $request->time_entry_id,
            'project_id'              => $timeEntry->project_id,
            's3_key'                  => $s3Key,
            'status'                  => 'pending',
            'idempotency_key'         => $request->input('idempotency_key'),
            'captured_at'             => $request->captured_at,
            'activity_score_at_capture' => $request->input('activity_score'),
            'app_name'                => $request->input('app_name'),
            'window_title'            => $request->input('window_title'),
            'display_index'           => $request->input('display_index'),
            'display_count'           => $request->input('display_count'),
            'is_blurred'              => $org->getSetting('blur_screenshots', false),
            'width'                   => $request->input('width', 1920),
            'height'                  => $request->input('height', 1080),
        ]);

        $uploadUrl = Storage::disk($this->disk())->temporaryUploadUrl(
            "screenshots/{$s3Key}",
            now()->addMinutes(15),
            ['Content-Type' => 'image/jpeg']
        );

        return response()->json(['screenshot_id' => $screenshot->id, 'upload_url' => $uploadUrl]);
    }

    // SS-01b: Confirm upload complete — verifies S3 object exists, dispatches processing job
    public function confirm(Request $request): JsonResponse
    {
        $request->validate(['screenshot_id' => 'required|uuid']);

        $screenshot = Screenshot::where('organization_id', $request->user()->organization_id)
            ->where('status', 'pending')
            ->findOrFail($request->screenshot_id);

        $storageKey = "screenshots/{$screenshot->s3_key}";
        if (!Storage::disk($this->disk())->exists($storageKey)) {
            return response()->json(['message' => 'Upload not found in storage. Upload the file first.'], 422);
        }

        $screenshot->update(['status' => 'confirmed']);

        ProcessScreenshotJob::dispatch($screenshot);

        return response()->json(['screenshot' => $screenshot->fresh()], 201);
    }

    // SS-02: List screenshots with filters
    public function index(Request $request): JsonResponse
    {
        $query = Screenshot::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('status', 'confirmed')
            ->with(['user', 'timeEntry', 'timeEntry.project']);

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
            $query->where('project_id', $request->project_id);
        }

        $screenshots = $query->orderBy('captured_at', 'desc')->paginate(
            min((int) $request->input('per_page', 50), 100)
        );

        // Batch-load closest activity log per screenshot — single query, O(1) vs old N+1
        $activityData = $this->batchLoadActivityLogs(
            $screenshots->getCollection(),
            $request->user()->organization_id
        );

        $disk = $this->disk();
        $screenshots->getCollection()->transform(function ($screenshot) use ($activityData, $disk) {
            $screenshot->thumbnail_url = $this->presignedGetUrl($screenshot->thumbnail_key ?? $screenshot->s3_key, $disk, 86400, $screenshot->id, 'thumbnail');
            $screenshot->url = $this->presignedGetUrl($screenshot->display_key ?? $screenshot->s3_key, $disk, 86400, $screenshot->id, 'display');
            $screenshot->original_url = $this->presignedGetUrl($screenshot->s3_key, $disk, 86400, $screenshot->id, 'original');
            $screenshot->user_name = $screenshot->user?->name ?? 'Unknown';
            $screenshot->user_avatar_color = substr(md5($screenshot->user_id ?? ''), 0, 6);
            $screenshot->activity_score = $screenshot->activity_score_at_capture
                ?? $screenshot->timeEntry?->activity_score
                ?? 0;
            $screenshot->project_name = $screenshot->timeEntry?->project?->name ?? null;
            $screenshot->app_name = $screenshot->app_name;
            $screenshot->window_title = $screenshot->window_title;

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
        $keys = array_filter([
            "screenshots/{$screenshot->s3_key}",
            $screenshot->thumbnail_key ? "screenshots/{$screenshot->thumbnail_key}" : null,
            $screenshot->display_key   ? "screenshots/{$screenshot->display_key}"   : null,
        ]);
        Storage::disk($disk)->delete(array_values($keys));

        $screenshot->delete();
        return response()->json(['message' => 'Screenshot deleted.']);
    }

    // SS-04: Redirect to S3 presigned GET URL — no byte streaming through the API
    public function show(Request $request, string $id): \Symfony\Component\HttpFoundation\Response
    {
        $signature = $request->query('sig', '');
        $expires   = (int) $request->query('expires', 0);
        $variant   = $request->query('variant', 'display');

        if (!$signature || !$expires || $expires < time()) {
            abort(403, 'Invalid or expired signature.');
        }

        if (!hash_equals(self::generateSignature($id, $variant, $expires), $signature)) {
            abort(403, 'Invalid signature.');
        }

        $screenshot = Screenshot::findOrFail($id);

        $key = match ($variant) {
            'thumbnail' => $screenshot->thumbnail_key ?? $screenshot->s3_key,
            'original'  => $screenshot->s3_key,
            default     => $screenshot->display_key ?? $screenshot->s3_key,
        };

        $url = Storage::disk($this->disk())->temporaryUrl(
            "screenshots/{$key}",
            now()->addHour()
        );

        return redirect($url);
    }

    // SS-05: Signed cookies — placeholder kept for forward-compat; real CloudFront cookies TBD
    public function signedCookies(Request $request): JsonResponse
    {
        return response()->json([
            'message'    => 'Signed cookies issued.',
            'expires_at' => now()->addHours(2)->toISOString(),
        ]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Single-query batch load of closest activity log per screenshot.
     * Eliminates the N+1 that the old per-screenshot loop caused.
     * Returns map of screenshot_id => ActivityLog|null.
     */
    private function batchLoadActivityLogs($collection, string $orgId): array
    {
        $valid = $collection->filter(fn ($ss) => $ss->time_entry_id && $ss->captured_at);
        if ($valid->isEmpty()) {
            return [];
        }

        $entryIds = $valid->pluck('time_entry_id')->unique()->values()->all();
        $minTime  = $valid->min('captured_at')->copy()->subMinutes(10);
        $maxTime  = $valid->max('captured_at')->copy()->addMinutes(10);

        $logs = ActivityLog::whereIn('time_entry_id', $entryIds)
            ->where('organization_id', $orgId)
            ->whereBetween('logged_at', [$minTime, $maxTime])
            ->get()
            ->groupBy('time_entry_id');

        $result = [];
        foreach ($valid as $ss) {
            $entryLogs = $logs->get($ss->time_entry_id, collect());
            $capturedAt = $ss->captured_at;

            $window = $entryLogs->filter(
                fn ($log) => $log->logged_at->between(
                    $capturedAt->copy()->subMinutes(10),
                    $capturedAt->copy()->addMinutes(10)
                )
            );

            if ($window->isNotEmpty()) {
                $result[$ss->id] = $window
                    ->sortBy(fn ($log) => abs($log->logged_at->diffInSeconds($capturedAt)))
                    ->first();
            }
        }

        return $result;
    }

    private function presignedGetUrl(
        string $s3Key,
        string $disk,
        int $ttlSeconds = 86400,
        string $screenshotId = '',
        string $variant = 'display'
    ): string {
        try {
            return Storage::disk($disk)->temporaryUrl(
                "screenshots/{$s3Key}",
                now()->addSeconds($ttlSeconds)
            );
        } catch (\Exception) {
            // Fallback: serve through signed API endpoint (used on local disk)
            return $this->getSignedFileUrl($screenshotId, $variant, $ttlSeconds);
        }
    }

    private static function generateSignature(string $screenshotId, string $variant, int $expires): string
    {
        return hash_hmac('sha256', "{$screenshotId}:{$variant}:{$expires}", config('app.key'));
    }

    private function getSignedFileUrl(string $screenshotId, string $variant = 'display', int $ttlSeconds = 7200): string
    {
        $expires = time() + $ttlSeconds;
        $sig = self::generateSignature($screenshotId, $variant, $expires);
        return url("/api/v1/screenshots/{$screenshotId}/file?" . http_build_query([
            'variant' => $variant,
            'expires' => $expires,
            'sig'     => $sig,
        ]));
    }
}
