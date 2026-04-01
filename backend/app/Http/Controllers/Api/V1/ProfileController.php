<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    /** Return the authenticated user's full profile. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->load('organization');

        return response()->json([
            'user' => $this->profileResponse($user),
        ]);
    }

    /** Update profile fields (name, job_title, phone, social links, bio, dates, timezone). */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name'            => 'required|string|max:255',
            'job_title'       => 'nullable|string|max:255',
            'phone'           => 'nullable|string|max:30',
            'linkedin_url'    => 'nullable|url|max:500',
            'github_url'      => 'nullable|url|max:500',
            'date_of_birth'   => 'nullable|date|before:today',
            'date_of_joining' => 'nullable|date',
            'bio'             => 'nullable|string|max:500',
            'timezone'        => ['nullable', 'string', Rule::in(timezone_identifiers_list())],
        ]);

        $user = $request->user();
        $user->update($validated);
        $user->load('organization');

        return response()->json([
            'user' => $this->profileResponse($user),
        ]);
    }

    /** Upload a profile avatar photo. Max 2MB, jpeg/png/webp/gif. */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            'avatar' => 'required|image|mimes:jpeg,png,webp,gif|max:2048',
        ]);

        $user = $request->user();
        $file = $request->file('avatar');
        $extension = $file->getClientOriginalExtension();
        $path = "avatars/{$user->id}.{$extension}";

        // Use S3 if configured, otherwise fall back to public disk
        $disk = config('filesystems.disks.s3.key') ? 's3' : 'public';

        // Delete old avatar if it exists
        if ($user->avatar_url) {
            if ($disk === 's3') {
                $oldPath = parse_url($user->avatar_url, PHP_URL_PATH);
                $bucket = config('filesystems.disks.s3.bucket');
                if ($oldPath && $bucket) {
                    $oldKey = ltrim(str_replace("/{$bucket}/", '', $oldPath), '/');
                    if ($oldKey !== $path && str_starts_with($oldKey, 'avatars/')) {
                        Storage::disk('s3')->delete($oldKey);
                    }
                }
            } else {
                // Local disk: extract path from URL
                $oldKey = str_replace('/storage/', '', parse_url($user->avatar_url, PHP_URL_PATH) ?? '');
                if ($oldKey && $oldKey !== $path && str_starts_with($oldKey, 'avatars/')) {
                    Storage::disk('public')->delete($oldKey);
                }
            }
        }

        Storage::disk($disk)->put($path, file_get_contents($file->getRealPath()), 'public');

        if ($disk === 's3') {
            $avatarUrl = Storage::disk('s3')->url($path);
        } else {
            // For local public disk, generate a proper URL
            $avatarUrl = url('/storage/' . $path);
        }

        $user->update(['avatar_url' => $avatarUrl]);

        return response()->json([
            'avatar_url' => $avatarUrl,
        ]);
    }

    /** Format the full profile response. */
    private function profileResponse($user): array
    {
        return [
            'id'              => $user->id,
            'organization_id' => $user->organization_id,
            'name'            => $user->name,
            'email'           => $user->email,
            'role'            => $user->role,
            'timezone'        => $user->timezone,
            'avatar_url'      => $user->avatar_url,
            'job_title'       => $user->job_title,
            'phone'           => $user->phone,
            'linkedin_url'    => $user->linkedin_url,
            'github_url'      => $user->github_url,
            'date_of_birth'   => $user->date_of_birth?->toDateString(),
            'date_of_joining' => $user->date_of_joining?->toDateString(),
            'bio'             => $user->bio,
            'is_active'       => $user->is_active,
            'last_active_at'  => $user->last_active_at,
            'email_verified_at' => $user->email_verified_at,
            'organization'    => [
                'id'           => $user->organization->id,
                'name'         => $user->organization->name,
                'slug'         => $user->organization->slug,
                'plan'         => $user->organization->plan,
                'trial_ends_at' => $user->organization->trial_ends_at,
                'settings'     => $user->organization->settings,
            ],
        ];
    }
}
