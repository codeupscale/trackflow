<?php

namespace App\Services;

use App\Models\Scopes\GlobalOrganizationScope;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Sanctum token lifecycle with client-aware sessions.
 *
 * - Web: multiple browser sessions allowed.
 * - Desktop: exactly one machine at a time (last-login-wins) — a new desktop login
 *   terminates every previous desktop session and closes any orphaned open timer.
 */
class AuthTokenService
{
    public const CLIENT_WEB = 'web';
    public const CLIENT_DESKTOP = 'desktop';

    public function __construct(
        private readonly TimerService $timerService,
    ) {}

    public static function clientFromRequest(?Request $request = null): string
    {
        $request ??= request();
        $header = strtolower((string) $request->header('X-TrackFlow-Client', self::CLIENT_WEB));

        return $header === self::CLIENT_DESKTOP ? self::CLIENT_DESKTOP : self::CLIENT_WEB;
    }

    public function requireDeviceIdFromRequest(?Request $request = null): string
    {
        $request ??= request();
        $deviceId = strtolower(trim((string) $request->header('X-Device-Id', '')));

        if ($deviceId === '' || ! preg_match('/^[a-f0-9]{32,64}$/', $deviceId)) {
            throw ValidationException::withMessages([
                'device' => ['A valid desktop device identifier is required.'],
            ]);
        }

        return $deviceId;
    }

    /**
     * On a desktop sign-in, take over the single desktop slot (last-login-wins):
     *
     *  - Close any timer left open by a crashed / uninstalled / force-killed agent,
     *    but ONLY once it has gone quiet (see below). The entry is ended at its last
     *    heartbeat, so phantom "non-tracked" time after the agent stopped reporting is
     *    discarded, never counted.
     *  - Revoke every previous DESKTOP token for the account, on any device. The
     *    prior machine's next request 401s and it logs itself out.
     *
     * Web sessions are intentionally left untouched (web + one desktop coexist).
     *
     * This replaces the previous 409 "already logged in" rejection, which could
     * permanently lock a user out when a prior session never cleanly logged out
     * (uninstall / crash / force-kill leaves the token + open timer behind).
     */
    public function terminatePreviousDesktopSessions(User $user): void
    {
        if ($this->hasAbandonedOpenTimer($user)) {
            $this->timerService->closeStaleOpenTimer($user);
        }

        $this->revokeAllDesktopTokens($user);
    }

    /**
     * True when the user's open timer really is abandoned, rather than actively being
     * tracked offline by an agent that simply has not synced yet.
     *
     * Under offline-first tracking an OPEN entry is no longer evidence of a dead
     * session: the desktop holds the live session in local SQLite and pushes it on a
     * ~60s cadence, so a laptop tracking on a plane legitimately leaves an open server
     * entry untouched for hours. Force-closing it on the next sign-in would truncate
     * real work at its last heartbeat, and the agent's next push would then have to
     * re-extend an entry login had just closed — a pointless fight between two writers.
     *
     * `client_synced_at` is the liveness signal: it is stamped on every successful
     * push. Only close when the agent has been silent for longer than the offline grace
     * window. A legacy entry that predates the column (null `client_synced_at`) falls
     * back to `started_at`, preserving the old behaviour for anything genuinely stale.
     */
    private function hasAbandonedOpenTimer(User $user): bool
    {
        $entry = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('organization_id', $user->organization_id)
            ->whereNull('ended_at')
            ->whereNull('deleted_at')
            ->latest('started_at')
            ->first();

        if ($entry === null) {
            return false;
        }

        $graceMinutes = (int) config('timer.offline_grace_minutes', 240);
        $lastContact = $entry->client_synced_at ?? $entry->started_at;

        return $lastContact->lt(now()->subMinutes($graceMinutes));
    }

    private function revokeAllDesktopTokens(User $user): void
    {
        $user->tokens()->get()->each(function (PersonalAccessToken $token) {
            if ($this->isDesktopToken($token)) {
                $token->delete();
            }
        });
    }

    public function pruneExpiredTokens(User $user): void
    {
        $user->tokens()->where('expires_at', '<', now())->delete();
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    public function issueTokenPair(
        User $user,
        string $client = self::CLIENT_WEB,
        bool $replaceClientSessions = true,
        ?string $deviceId = null,
    ): array {
        $this->pruneExpiredTokens($user);

        if ($client === self::CLIENT_DESKTOP) {
            if ($replaceClientSessions && $deviceId !== null) {
                $this->revokeDesktopTokensForDevice($user, $deviceId);
            }
        }

        $accessAbilities = $client === self::CLIENT_DESKTOP
            ? array_filter(['*', 'client:desktop', $deviceId ? "device:{$deviceId}" : null])
            : ['*', 'client:web'];
        $refreshAbilities = $client === self::CLIENT_DESKTOP
            ? array_filter(['refresh', 'client:desktop', $deviceId ? "device:{$deviceId}" : null])
            : ['refresh', 'client:web'];

        $names = $this->tokenNames($client);

        $access = $user->createToken(
            $names['access'],
            array_values($accessAbilities),
            now()->addMinutes(config('security.tokens.access_ttl'))
        );
        $refresh = $user->createToken(
            $names['refresh'],
            array_values($refreshAbilities),
            now()->addMinutes(config('security.tokens.refresh_ttl'))
        );

        return [
            'access_token' => $access->plainTextToken,
            'refresh_token' => $refresh->plainTextToken,
        ];
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    public function rotateCurrentSession(User $user): array
    {
        /** @var PersonalAccessToken $current */
        $current = $user->currentAccessToken();
        $client = $this->clientForToken($current);
        $deviceId = $this->tokenDeviceId($current);
        $current->delete();

        return $this->issueTokenPair($user, $client, replaceClientSessions: false, deviceId: $deviceId);
    }

    public function revokeAllTokens(User $user): void
    {
        $user->tokens()->delete();
    }

    public function tokenDeviceId(?PersonalAccessToken $token): ?string
    {
        if ($token === null) {
            return null;
        }

        foreach ($token->abilities ?? [] as $ability) {
            if (str_starts_with($ability, 'device:')) {
                return substr($ability, 7);
            }
        }

        return null;
    }

    public function clientForToken(PersonalAccessToken $token): string
    {
        return $this->isDesktopToken($token) ? self::CLIENT_DESKTOP : self::CLIENT_WEB;
    }

    private function isDesktopToken(PersonalAccessToken $token): bool
    {
        // Match abilities LITERALLY — never via can(), because the access token
        // carries the '*' wildcard and can('client:web') would be true for it,
        // misclassifying every desktop access token as web (and so leaving it
        // un-revoked on session takeover).
        $abilities = $token->abilities ?? [];

        if (in_array('client:desktop', $abilities, true) || str_starts_with($token->name, 'desktop_')) {
            return true;
        }

        if (in_array('client:web', $abilities, true)) {
            return false;
        }

        // Legacy desktop agent tokens (pre client-tag) used access_token / refresh_token names.
        return in_array($token->name, ['access_token', 'refresh_token'], true);
    }

    private function revokeDesktopTokensForDevice(User $user, string $deviceId): void
    {
        $user->tokens()->get()->each(function (PersonalAccessToken $token) use ($deviceId) {
            if (! $this->isDesktopToken($token)) {
                return;
            }

            $tokenDeviceId = $this->tokenDeviceId($token);
            if ($tokenDeviceId === null || $tokenDeviceId === $deviceId) {
                $token->delete();
            }
        });
    }

    /**
     * @return array{access: string, refresh: string}
     */
    private function tokenNames(string $client): array
    {
        if ($client === self::CLIENT_DESKTOP) {
            return [
                'access' => 'desktop_access_token',
                'refresh' => 'desktop_refresh_token',
            ];
        }

        return [
            'access' => 'access_token',
            'refresh' => 'refresh_token',
        ];
    }
}
