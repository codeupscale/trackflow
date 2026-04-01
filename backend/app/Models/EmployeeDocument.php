<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

class EmployeeDocument extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'user_id',
        'title',
        'category',
        'file_path',
        'file_name',
        'file_size',
        'mime_type',
        'expiry_date',
        'is_verified',
        'verified_by',
        'verified_at',
        'notes',
    ];

    /**
     * Raw S3 path must never be exposed in API responses.
     * Clients receive a time-limited signed URL via the download_url append.
     */
    protected $hidden = ['file_path'];

    protected $appends = ['download_url'];

    protected function casts(): array
    {
        return [
            'is_verified' => 'boolean',
            'expiry_date' => 'date',
            'verified_at' => 'datetime',
            'file_size' => 'integer',
        ];
    }

    /**
     * Generate a 15-minute signed S3 URL for secure document access.
     */
    public function getDownloadUrlAttribute(): ?string
    {
        if (! $this->file_path) {
            return null;
        }

        return Storage::disk('s3')->temporaryUrl($this->file_path, now()->addMinutes(15));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function verifiedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }
}
