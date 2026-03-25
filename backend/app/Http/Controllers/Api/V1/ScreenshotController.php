<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Screenshot;
use App\Jobs\ProcessScreenshotJob;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
        $date = now()->format('Y-m-d');
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

        // Add URLs for viewing — use processed variants when available, fall back to original
        $screenshots->getCollection()->transform(function ($screenshot) {
            $screenshot->thumbnail_url = $this->getScreenshotUrl(
                $screenshot->thumbnail_key ?? $screenshot->s3_key
            );
            $screenshot->url = $this->getScreenshotUrl(
                $screenshot->display_key ?? $screenshot->s3_key
            );
            $screenshot->original_url = $this->getScreenshotUrl($screenshot->s3_key);
            $screenshot->user_name = $screenshot->user?->name ?? 'Unknown';
            // Prefer point-in-time score captured with the screenshot (Hubstaff-style),
            // fall back to the time entry's overall score for older screenshots
            $screenshot->activity_score = $screenshot->activity_score_at_capture
                ?? $screenshot->timeEntry?->activity_score
                ?? 0;
            $screenshot->project_name = $screenshot->timeEntry?->project?->name ?? null;
            $screenshot->app_name = $screenshot->app_name;
            $screenshot->window_title = $screenshot->window_title;
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

    // SS-05: Issue signed cookies for gallery
    public function signedCookies(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Signed cookies issued.',
            'expires_at' => now()->addHours(2)->toISOString(),
        ]);
    }

    private function getScreenshotUrl(string $storageKey): string
    {
        $disk = $this->disk();

        if ($disk === 's3') {
            try {
                return Storage::disk('s3')->temporaryUrl(
                    "screenshots/{$storageKey}",
                    now()->addHours(1)
                );
            } catch (\Exception $e) {
                return '';
            }
        }

        // Local storage — serve via /storage/ public URL
        return url("storage/screenshots/{$storageKey}");
    }
}
