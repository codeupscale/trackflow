<?php

namespace App\Models\Traits;

use App\Models\Organization;
use App\Models\Scopes\GlobalOrganizationScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;

trait BelongsToOrganization
{
    public static function bootBelongsToOrganization(): void
    {
        static::addGlobalScope(new GlobalOrganizationScope);

        static::creating(function ($model) {
            if (empty($model->organization_id) && Auth::check()) {
                $model->organization_id = Auth::user()->organization_id;
            }
        });
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
