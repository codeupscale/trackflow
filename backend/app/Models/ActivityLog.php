<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActivityLog extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    public $timestamps = false;

    protected $fillable = [
        'organization_id',
        'user_id',
        'time_entry_id',
        'logged_at',
        'keyboard_events',
        'mouse_events',
        'active_app',
        'active_window_title',
        'active_url',
    ];

    protected function casts(): array
    {
        return [
            'logged_at' => 'datetime',
            'keyboard_events' => 'integer',
            'mouse_events' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function timeEntry(): BelongsTo
    {
        return $this->belongsTo(TimeEntry::class);
    }
}
