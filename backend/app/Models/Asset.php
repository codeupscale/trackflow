<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A piece of company property: a laptop, a SIM card, a software licence.
 *
 * The item and its CURRENT state only. Who has had it, and when, lives in
 * AssetAssignment — see the migration for why the two are kept apart.
 */
class Asset extends Model
{
    use BelongsToOrganization, HasUuids, SoftDeletes;

    public const CATEGORIES = [
        'laptop', 'desktop', 'monitor', 'phone', 'tablet',
        'sim_card', 'id_card', 'accessory', 'furniture', 'software_license', 'other',
    ];

    /**
     * available  — in stock, ready to hand out
     * assigned   — with someone; current_holder_id is set
     * in_repair  — out of service for now, comes back to available
     * retired    — end of life, kept for the record
     * lost       — gone; kept so the loss stays on file
     */
    public const STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'lost'];

    public const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];

    protected $fillable = [
        'organization_id',
        'asset_tag',
        'name',
        'category',
        'brand',
        'model',
        'serial_number',
        'purchase_date',
        'purchase_cost',
        'warranty_expires_on',
        'status',
        'condition',
        'current_holder_id',
        'created_by',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'purchase_date' => 'date:Y-m-d',
            'warranty_expires_on' => 'date:Y-m-d',
            'purchase_cost' => 'decimal:2',
        ];
    }

    public function holder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'current_holder_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(AssetAssignment::class)->orderByDesc('assigned_at');
    }

    /** The hand-over that is still open, if the item is with someone. */
    public function openAssignment(): HasOne
    {
        return $this->hasOne(AssetAssignment::class)->whereNull('returned_at');
    }
}
