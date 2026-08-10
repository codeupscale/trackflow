<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class JobPosting extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
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
        'is_published',
    ];

    /**
     * Salary is hidden by default, exactly as on Position. The public careers
     * feed ADDS these back via makeVisible() when send_salary_via_api is on —
     * it never strips them when it is off. That way the failure mode of any
     * future bug is omitting the salary, not leaking it.
     */
    protected $hidden = ['min_salary', 'max_salary'];

    protected function casts(): array
    {
        return [
            'min_salary' => 'encrypted',
            'max_salary' => 'encrypted',
            'send_salary_via_api' => 'boolean',
            'is_published' => 'boolean',
            // date:Y-m-d, not plain date. A plain date cast serialises as
            // "2026-08-15T00:00:00.000000Z", which <input type="date"> cannot
            // parse — the field renders blank on edit and the next save writes
            // null back, silently destroying the date.
            'posting_date' => 'date:Y-m-d',
        ];
    }

    /**
     * Laravel's `encrypted` cast always decrypts to a STRING, whatever type went
     * in — so a salary stored as 200000 comes back as "200000" and any consumer
     * expecting a number (the edit form's schema, for one) rejects it. There is
     * no `encrypted:float`, so the conversion has to happen at serialisation.
     */
    public function toArray(): array
    {
        $array = parent::toArray();

        foreach (['min_salary', 'max_salary'] as $key) {
            if (array_key_exists($key, $array) && $array[$key] !== null) {
                $array[$key] = (float) $array[$key];
            }
        }

        return $array;
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    /**
     * Is this posting visible on the public careers feed right now?
     *
     * posting_date is a "not before" gate — the form labels it
     * "Cannot publish before this date" — so a future date keeps an
     * already-published posting off the feed until that day arrives.
     */
    public function isPubliclyVisible(): bool
    {
        if (! $this->is_published) {
            return false;
        }

        return $this->posting_date === null
            || $this->posting_date->isToday()
            || $this->posting_date->isPast();
    }

    /**
     * Human-readable salary, or null when there is nothing to show.
     *
     * Defined once here so the trackflow admin list and the careers page cannot
     * drift: only min => "From X", only max => "Up to Y", both => "X - Y".
     *
     * Validation requires max > min, so the equal case is unreachable through
     * the API. It is still handled defensively — data can arrive from an import
     * or a direct DB edit, and "80,000 - 80,000" would look like a bug.
     */
    public function salaryDisplay(): ?string
    {
        if (! $this->send_salary_via_api) {
            return null;
        }

        $min = $this->min_salary !== null ? (float) $this->min_salary : null;
        $max = $this->max_salary !== null ? (float) $this->max_salary : null;

        if ($min === null && $max === null) {
            return null;
        }

        if ($min !== null && $max === null) {
            return 'From '.number_format($min);
        }

        if ($min === null && $max !== null) {
            return 'Up to '.number_format($max);
        }

        if ($min === $max) {
            return number_format($min);
        }

        return number_format($min).' - '.number_format($max);
    }
}
