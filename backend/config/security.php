<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Sanctum Token Lifetimes (minutes)
    |--------------------------------------------------------------------------
    |
    | Lifetime of issued access / refresh tokens. Passed to createToken() as
    | now()->addMinutes(...). Defaults preserve the previous hardcoded values
    | (access = 24h, refresh = 30d).
    |
    */

    'tokens' => [
        'access_ttl'  => (int) env('AUTH_ACCESS_TOKEN_TTL', 1440),    // 24 hours
        'refresh_ttl' => (int) env('AUTH_REFRESH_TOKEN_TTL', 43200),  // 30 days
    ],

    /*
    |--------------------------------------------------------------------------
    | API Rate Limits (requests per minute)
    |--------------------------------------------------------------------------
    |
    | Registered in AppServiceProvider via RateLimiter::for(). Defaults match
    | the documented limits (general = 1000/min, auth = 10/min).
    |
    */

    'rate_limits' => [
        'api'  => (int) env('RATE_LIMIT_API', 1000),
        'auth' => (int) env('RATE_LIMIT_AUTH', 10),
    ],

    /*
    |--------------------------------------------------------------------------
    | Lifecycle Expiries (days)
    |--------------------------------------------------------------------------
    |
    | invitation_ttl : how long an org invitation stays valid.
    | trial_days     : trial length granted on new-org registration.
    | grace_period   : trial/grace window after a subscription is cancelled.
    |
    */

    'invitation_ttl_days' => (int) env('INVITATION_TTL_DAYS', 7),
    'trial_days'          => (int) env('TRIAL_DAYS', 14),
    'grace_period_days'   => (int) env('GRACE_PERIOD_DAYS', 30),

    /*
    |--------------------------------------------------------------------------
    | Signed URL Lifetimes (minutes)
    |--------------------------------------------------------------------------
    |
    | TTLs for S3 temporary (presigned) URLs. Defaults preserve previous
    | hardcoded values.
    |
    */

    'signed_urls' => [
        'screenshot_upload_ttl' => (int) env('SIGNED_URL_SCREENSHOT_UPLOAD_TTL', 15),  // 15 minutes
        'screenshot_view_ttl'   => (int) env('SIGNED_URL_SCREENSHOT_VIEW_TTL', 60),    // 1 hour
        'document_ttl'          => (int) env('SIGNED_URL_DOCUMENT_TTL', 15),           // 15 minutes
        'report_ttl'            => (int) env('SIGNED_URL_REPORT_TTL', 1440),           // 24 hours
    ],

];
