<?php

namespace App\Services;

use App\Models\JobPosting;
use App\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Recruitment lives here rather than in OrganizationStructureService: a job
 * posting is a hiring artefact, not part of the org chart.
 */
class JobPostingService
{
    /** Fields a posting owns. Salary is a snapshot, not a live read from the position. */
    private const ATTRIBUTES = [
        'department_id',
        'position_id',
        'title',
        'employment_type',
        'work_mode',
        'location',
        'posting_date',
        'start_time',
        'end_time',
        'min_salary',
        'max_salary',
        'send_salary_via_api',
        'short_description',
        'long_description',
    ];

    /**
     * New postings go live immediately.
     *
     * Note the permission consequence: because is_published is not part of the
     * create payload, creating a posting IS publishing it, so job_postings.create
     * effectively confers job_postings.publish. No current system role has one
     * without the other (org_manager and hr_manager hold both), but a custom
     * role granting create alone would be able to publish. Unpublishing still
     * requires job_postings.publish.
     */
    public function create(Organization $org, array $data): JobPosting
    {
        $attributes = ['organization_id' => $org->id, 'is_published' => true];

        foreach (self::ATTRIBUTES as $key) {
            $attributes[$key] = $data[$key] ?? null;
        }

        $attributes['send_salary_via_api'] = (bool) ($data['send_salary_via_api'] ?? false);

        if ($this->isFutureDate($attributes['posting_date'] ?? null)) {
            $attributes['is_published'] = false;
        }

        return JobPosting::create($this->normaliseSalary($attributes));
    }

    public function update(JobPosting $posting, array $data): JobPosting
    {
        $attributes = $this->normaliseSalary($data);

        // Fall back to the stored date on a partial update.
        $postingDate = array_key_exists('posting_date', $attributes)
            ? $attributes['posting_date']
            : $posting->posting_date;

        if ($this->isFutureDate($postingDate)) {
            $attributes['is_published'] = false;
        }

        $posting->update($attributes);

        return $posting->fresh(['department', 'position']);
    }

    /**
     * @throws \Illuminate\Validation\ValidationException when publishing a
     *         posting whose posting_date has not arrived yet.
     */
    public function setPublished(JobPosting $posting, bool $published): JobPosting
    {
        // A future-dated posting cannot be publicly visible, so accepting the
        // publish would flip the badge to "Published" while the careers page
        // showed nothing — the status would be lying. update() already forces
        // such postings back to draft; without this guard the two paths
        // disagreed and this one silently won.
        if ($published && $this->isFutureDate($posting->posting_date)) {
            throw ValidationException::withMessages([
                'is_published' => 'This posting is dated '
                    .$posting->posting_date->toFormattedDateString()
                    .'. Change the posting date to today or earlier before publishing.',
            ]);
        }

        $posting->update(['is_published' => $published]);

        return $posting->fresh(['department', 'position']);
    }

    public function delete(JobPosting $posting): void
    {
        $posting->delete();
    }

    /**
     * An empty string from a cleared form field means "no value", not zero.
     * Left as-is it would encrypt to "" and then read back as a 0 salary,
     * which would publish "From 0" on the careers page.
     */
    /**
     * A posting dated in the future is not publicly visible yet, so it is held
     * as a draft until that date arrives. Without this the list would show
     * "Published" while the careers page showed nothing — the status would be
     * lying. Note this only ever forces a posting DOWN to draft: moving the date
     * back does not silently republish it, that stays a deliberate action.
     */
    private function isFutureDate(mixed $date): bool
    {
        if (! $date) {
            return false;
        }

        try {
            return Carbon::parse((string) $date)->startOfDay()->isFuture();
        } catch (\Throwable) {
            return false;
        }
    }

    private function normaliseSalary(array $attributes): array
    {
        foreach (['min_salary', 'max_salary'] as $key) {
            if (array_key_exists($key, $attributes) && $attributes[$key] === '') {
                $attributes[$key] = null;
            }
        }

        return $attributes;
    }
}
