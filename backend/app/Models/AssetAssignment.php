<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One hand-over of an asset to a person, closed when it comes back.
 *
 * Rows are appended, never rewritten. Returning an item fills in the returned_*
 * columns of the open row; assigning it again starts a new row. That is what
 * keeps "who had it, when, and in what state" answerable forever.
 */
class AssetAssignment extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $fillable = [
        'organization_id',
        'asset_id',
        'user_id',
        'assigned_by',
        'assigned_at',
        'condition_on_assign',
        'expected_return_on',
        'returned_at',
        'received_by',
        'condition_on_return',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'assigned_at' => 'datetime',
            'returned_at' => 'datetime',
            'expected_return_on' => 'date:Y-m-d',
        ];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class)->withTrashed();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assigner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}
