<?php

namespace App\Http\Middleware;

use App\Services\PermissionService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        if (!$user) {
            abort(401, 'Unauthenticated.');
        }

        // Owner bypasses all permission checks
        if ($user->isOwner()) {
            return $next($request);
        }

        foreach ($permissions as $permission) {
            if (PermissionService::userCan($user, $permission)) {
                return $next($request);
            }
        }

        abort(403, 'Insufficient permissions.');
    }
}
