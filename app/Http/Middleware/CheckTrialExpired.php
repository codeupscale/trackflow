<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckTrialExpired
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (!$user) {
            return $next($request);
        }

        $org = $user->organization;

        // Skip check for billing endpoints (so they can upgrade)
        if (str_starts_with($request->path(), 'api/v1/billing')) {
            return $next($request);
        }

        // Skip for auth endpoints
        if (str_starts_with($request->path(), 'api/v1/auth')) {
            return $next($request);
        }

        // Check if trial has expired and no active subscription
        if ($org->plan === 'trial' && $org->trial_ends_at && $org->trial_ends_at->isPast()) {
            return response()->json([
                'message' => 'Your trial has expired. Please upgrade to continue.',
                'upgrade_url' => '/settings/billing',
            ], 402);
        }

        return $next($request);
    }
}
