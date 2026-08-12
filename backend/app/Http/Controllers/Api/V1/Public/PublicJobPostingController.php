<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Models\JobPosting;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Unauthenticated careers feed.
 *
 * SECURITY — read before changing anything here.
 *
 * JobPosting uses BelongsToOrganization, whose GlobalOrganizationScope only
 * applies `where organization_id = ...` when Auth::check() is true. On this
 * endpoint nobody is authenticated, so THE GLOBAL SCOPE DOES NOTHING. Every
 * query below must scope by organization explicitly. A query that merely
 * filters on is_published would return every tenant's postings, and it would
 * look perfectly correct in a single-org development database.
 *
 * The response is also assembled field by field rather than serialising the
 * model, so a column added later cannot leak by default.
 */
class PublicJobPostingController extends Controller
{
    private const MAX_PER_PAGE = 100;

    public function index(Request $request, string $slug): JsonResponse
    {
        $organization = Organization::where('slug', $slug)->firstOrFail();

        $perPage = min(
            (int) $request->integer('per_page', 50) ?: 50,
            self::MAX_PER_PAGE,
        );

        $query = JobPosting::query()
            // Explicit: the global scope is inert for unauthenticated requests.
            ->where('organization_id', $organization->id)
            ->where('is_published', true)
            // posting_date is a "not before" gate, so a future date stays unlisted.
            ->where(function ($q) {
                $q->whereNull('posting_date')
                    ->orWhereDate('posting_date', '<=', now()->toDateString());
            })
            ->with(['department:id,name', 'position:id,title']);

        if ($request->filled('department')) {
            $department = $request->input('department');
            $query->whereHas('department', fn ($q) => $q->where('name', $department));
        }

        if ($request->filled('search')) {
            $query->where('title', 'like', '%'.$request->input('search').'%');
        }

        $postings = $query
            ->orderByDesc('posting_date')
            ->orderByDesc('created_at')
            ->paginate($perPage);

        return response()->json([
            'data' => collect($postings->items())
                ->map(fn (JobPosting $posting) => $this->present($posting))
                ->all(),
            'meta' => [
                'total' => $postings->total(),
                'per_page' => $postings->perPage(),
                'current_page' => $postings->currentPage(),
                'last_page' => $postings->lastPage(),
            ],
        ])
            // Deliberately uncached.
            //
            // This used to send `public, max-age=60`, which meant a posting
            // stayed on the careers page for up to a minute after HR
            // unpublished it — the browser answered the reload from its own
            // cache without ever asking us. Postings are usually pulled
            // because they are filled or wrong, so a stale advert is a real
            // problem, while the saving was only ever a handful of queries
            // from repeat visitors. `throttle:api` on the route is what
            // actually protects this endpoint from abuse.
            //
            // If this is ever fronted by a CDN, add `s-maxage` (shared caches
            // only) rather than reinstating `max-age` — a CDN can be purged on
            // unpublish, a visitor's browser cannot.
            ->header('Cache-Control', 'no-store');
    }

    /**
     * Explicit allow-list of what the public may see.
     */
    private function present(JobPosting $posting): array
    {
        $payload = [
            'id' => $posting->id,
            'title' => $posting->title,
            'department' => $posting->department?->name,
            'position' => $posting->position?->title,
            'employment_type' => $posting->employment_type,
            'work_mode' => $posting->work_mode,
            'location' => $posting->location,
            'working_hours' => $this->workingHours($posting),
            'short_description' => $posting->short_description,
            // Sanitised on save by JobDescriptionSanitizer, so the careers page
            // can render this directly. Nothing unsafe reaches the column.
            'long_description' => $posting->long_description,
            'posting_date' => $posting->posting_date?->toDateString(),
        ];

        // Salary keys are ADDED when the toggle is on rather than stripped when
        // it is off, so any future mistake omits the range instead of leaking it.
        if ($posting->send_salary_via_api) {
            $display = $posting->salaryDisplay();

            if ($display !== null) {
                $payload['salary_display'] = $display;
                $payload['salary_min'] = $posting->min_salary !== null ? (float) $posting->min_salary : null;
                $payload['salary_max'] = $posting->max_salary !== null ? (float) $posting->max_salary : null;
            }
        }

        return $payload;
    }

    /** "09:00:00" + "18:00:00" -> "9:00 AM - 6:00 PM" */
    private function workingHours(JobPosting $posting): ?string
    {
        if (! $posting->start_time || ! $posting->end_time) {
            return null;
        }

        return $this->to12Hour((string) $posting->start_time)
            .' - '
            .$this->to12Hour((string) $posting->end_time);
    }

    private function to12Hour(string $time): string
    {
        [$hours, $minutes] = array_pad(explode(':', $time), 2, '00');
        $hours = (int) $hours;
        $suffix = $hours >= 12 ? 'PM' : 'AM';
        // 0 -> 12 AM, 12 -> 12 PM, 13 -> 1 PM
        $hour12 = $hours % 12 === 0 ? 12 : $hours % 12;

        return $hour12.':'.$minutes.' '.$suffix;
    }
}
