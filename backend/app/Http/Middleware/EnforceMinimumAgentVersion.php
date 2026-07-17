<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects desktop agents older than the configured minimum version.
 *
 * WHY THIS EXISTS: client-side policy is advisory. Removing the "Keep idle time"
 * and "Reassign" buttons only enforces anything if an employee cannot simply keep
 * running an older build that still has them. The desktop has always sent
 * X-Agent-Version; until now nothing read it.
 *
 * SCOPE: only requests that identify as the desktop agent (X-TrackFlow-Client:
 * desktop) are gated. The web dashboard never sends that header, so it is never
 * affected.
 *
 * FAIL-OPEN BY DESIGN: with no minimum configured (the default), this is a
 * no-op. A misconfigured minimum could lock every desktop out of tracking
 * entirely, so the safe state is "allow" and the gate must be switched on
 * deliberately via TIMER_MIN_AGENT_VERSION.
 *
 * Returns 426 Upgrade Required — distinct from 401/403 so the desktop can tell
 * "you must update" apart from "your session is invalid" and must never treat it
 * as an auth failure that triggers a logout.
 */
class EnforceMinimumAgentVersion
{
    private const CLIENT_DESKTOP = 'desktop';

    public function handle(Request $request, Closure $next): Response
    {
        $min = config('timer.min_agent_version');

        // Gate disabled (default) — no-op.
        if (empty($min)) {
            return $next($request);
        }

        $client = strtolower(trim((string) $request->header('X-TrackFlow-Client', '')));
        if ($client !== self::CLIENT_DESKTOP) {
            return $next($request);
        }

        $version = trim((string) $request->header('X-Agent-Version', ''));

        // A desktop build old enough to omit the header predates every current
        // release, so it is below any minimum we would set.
        if ($version === '' || version_compare($this->normalize($version), $this->normalize($min), '<')) {
            return response()->json([
                'message' => 'This version of the TrackFlow desktop app is no longer supported. Please update to continue tracking time.',
                'code' => 'AGENT_UPGRADE_REQUIRED',
                'min_version' => $min,
                'your_version' => $version !== '' ? $version : null,
            ], Response::HTTP_UPGRADE_REQUIRED);
        }

        return $next($request);
    }

    /**
     * Strip any pre-release/build suffix (e.g. "1.0.41-dev.64" -> "1.0.41") so a
     * dev build of the current version is not treated as older than its release.
     */
    private function normalize(string $version): string
    {
        return preg_replace('/[-+].*$/', '', $version) ?: $version;
    }
}
