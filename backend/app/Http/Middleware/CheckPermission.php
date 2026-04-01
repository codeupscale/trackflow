<?php

namespace App\Http\Middleware;

use App\Services\PermissionService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    public function __construct(private readonly PermissionService $permissions) {}

    /**
     * Usage in routes:
     *   ->middleware('permission:time_entries.view')           // any scope
     *   ->middleware('permission:time_entries.view,team')      // team or higher
     *   ->middleware('permission:settings.edit_org')           // non-scoped
     */
    public function handle(Request $request, Closure $next, string $permission, ?string $scope = null): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(401);
        }

        // Owner bypass — owners have all permissions implicitly
        if ($user->role === 'owner') {
            return $next($request);
        }

        if (! $this->permissions->hasPermission($user, $permission, $scope)) {
            abort(403, 'Insufficient permissions.');
        }

        return $next($request);
    }
}
