<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckSeatLimit
{
    private array $limits = [
        'trial' => 5,
        'starter' => 20,
        'pro' => PHP_INT_MAX,
        'enterprise' => PHP_INT_MAX,
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (!$user) {
            return $next($request);
        }

        $org = $user->organization;
        $limit = $this->limits[$org->plan] ?? 5;

        $currentSeats = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->count();

        if ($currentSeats >= $limit) {
            return response()->json([
                'message' => 'Seat limit reached. Please upgrade your plan.',
                'current_seats' => $currentSeats,
                'seat_limit' => $limit,
                'upgrade_url' => '/settings/billing',
            ], 402);
        }

        return $next($request);
    }
}
