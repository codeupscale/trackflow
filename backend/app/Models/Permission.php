<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Permission extends Model
{
    use HasUuids, HasFactory;

    /**
     * Permissions table only has created_at, no updated_at.
     */
    public $timestamps = false;

    protected $fillable = [
        'key',
        'module',
        'action',
        'description',
        'has_scope',
    ];

    protected $casts = [
        'has_scope' => 'boolean',
    ];

    /**
     * Roles that have this permission (with pivot scope).
     * No GlobalOrganizationScope — permissions are a global registry.
     */
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'role_permissions')
            ->withPivot('scope');
    }
}
