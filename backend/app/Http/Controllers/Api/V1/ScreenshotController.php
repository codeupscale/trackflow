<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Screenshot;
use App\Jobs\ProcessScreenshotJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ScreenshotController extends Controller
{
    // SS-01: Upload screenshot from agent
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|image|mimes:jpeg,jpg,png|max:5120',
            'time_entry_id' => 'required|uuid',
            'captured_at' => 'required|date',
        ]);

        $user = $request->user();

        // Validate that time_entry_id belongs to the authenticated user
        $user->timeEntries()->where('id', $request->time_entry_id)->firstOrFail();

        $org = $user->organization;
        $date = now()->format('Y-m-d');
        $filename = time() . '_' . Str::random(8) . '.jpg';
        $s3Key = "{$org->id}/{$user->id}/{$date}/{$filename}";

        // Store to S3 (or local for dev)
        $path = $request->file('file')->storeAs(
            "screenshots/{$org->id}/{$user->id}/{$date}",
            $filename,
            's3'
        );

        $screenshot = Screenshot::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $request->time_entry_id,
            's3_key' => $s3Key,
            'captured_at' => $request->captured_at,
            'is_blurred' => $org->getSetting('blur_screenshots', false),
        ]);

        ProcessScreenshotJob::dispatch($screenshot);

        return response()->json(['screenshot' => $screenshot], 201);
    }

    // SS-02: List screenshots with filters
    public function index(Request $request): JsonResponse
    {
        $query = Screenshot::query()
            ->where('organization_id', $request->user()->organization_id)
            ->with('user');

        // Employees see only own screenshots
        if ($request->user()->isEmployee()) {
            $query->where('user_id', $request->user()->id);
        } elseif ($request->has('user_id')) {
            $request->user()->organization->users()->findOrFail($request->user_id);
            $query->where('user_id', $request->user_id);
        }

        if ($request->has('date_from')) {
            $query->where('captured_at', '>=', $request->date_from);
        }
        if ($request->has('date_to')) {
            $query->where('captured_at', '<=', $request->date_to);
        }
        if ($request->has('time_entry_id')) {
            $query->where('time_entry_id', $request->time_entry_id);
        }

        $screenshots = $query->orderBy('captured_at', 'desc')->paginate(
            min((int) $request->input('per_page', 50), 100)
        );

        // Add signed URLs
        $screenshots->getCollection()->transform(function ($screenshot) {
            $screenshot->url = $this->getSignedUrl($screenshot->s3_key);
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

        // Delete from S3
        Storage::disk('s3')->delete("screenshots/{$screenshot->s3_key}");

        $screenshot->delete();
        return response()->json(['message' => 'Screenshot deleted.']);
    }

    // SS-05: Issue signed cookies for gallery
    public function signedCookies(Request $request): JsonResponse
    {
        // In production, this would issue CloudFront signed cookies
        // For now, return a placeholder indicating the feature
        return response()->json([
            'message' => 'Signed cookies issued.',
            'expires_at' => now()->addHours(2)->toISOString(),
        ]);
    }

    private function getSignedUrl(string $s3Key): string
    {
        // In production: CloudFront signed URL
        // For development: use temporary S3 URL
        return Storage::disk('s3')->temporaryUrl(
            "screenshots/{$s3Key}",
            now()->addMinutes(15)
        );
    }
}
