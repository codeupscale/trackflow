<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Sanctum token lifecycle with client-aware sessions.
 *
 * - Web: multiple browser sessions allowed; tokens tagged client:web.
 * - Desktop: only one active desktop agent per user; a new desktop login
 *   revokes prior desktop (and legacy untagged agent) tokens, not web.
 */
class AuthTokenService
{
    public const CLIENT_WEB = 'web';
    public const CLIENT_DESKTOP = 'desktop';

    public static function clientFromRequest(?Request $request = null): string
    {
        $request ??= request();
        $header = strtolower((string) $request->header('X-TrackFlow-Client', self::CLIENT_WEB));

        return $header === self::CLIENT_DESKTOP ? self::CLIENT_DESKTOP : self::CLIENT_WEB;
    }

    public function pruneExpiredTokens(User $user): void
    {
        $user->tokens()->where('expires_at', '<', now())->delete();
    }

    /**
     * @param  bool  $replaceClientSessions  When true on desktop login, end other desktop agents.
     * @return array{access_token: string, refresh_token: string}
     */
    public function issueTokenPair(
        User $user,
        string $client = self::CLIENT_WEB,
        bool $replaceClientSessions = true,
    ): array {
        $this->pruneExpiredTokens($user);

        if ($client === self::CLIENT_DESKTOP && $replaceClientSessions) {
            $this->revokeDesktopSessions($user);
        }

        $names = $this->tokenNames($client);
        $accessAbilities = $client === self::CLIENT_DESKTOP ? ['*', 'client:desktop'] : ['*', 'client:web'];
        $refreshAbilities = $client === self::CLIENT_DESKTOP
            ? ['refresh', 'client:desktop']
            : ['refresh', 'client:web'];

        $access = $user->createToken(
            $names['access'],
            $accessAbilities,
            now()->addMinutes(config('security.tokens.access_ttl'))
        );
        $refresh = $user->createToken(
            $names['refresh'],
            $refreshAbilities,
            now()->addMinutes(config('security.tokens.refresh_ttl'))
        );

        return [
            'access_token' => $access->plainTextToken,
            'refresh_token' => $refresh->plainTextToken,
        ];
    }

    /**
     * Refresh rotation: revoke only the token used for this request, then issue a new pair
     * for the same client type.
     *
     * @return array{access_token: string, refresh_token: string}
     */
    public function rotateCurrentSession(User $user): array
    {
        /** @var PersonalAccessToken $current */
        $current = $user->currentAccessToken();
        $client = $this->clientForToken($current);
        $current->delete();

        return $this->issueTokenPair($user, $client, replaceClientSessions: false);
    }

    public function revokeAllTokens(User $user): void
    {
        $user->tokens()->delete();
    }

    /**
     * End every desktop agent session for this user while keeping web sessions.
     */
    public function revokeDesktopSessions(User $user): void
    {
        $names = $this->tokenNames(self::CLIENT_DESKTOP);

        $user->tokens()
            ->whereIn('name', array_values($names))
            ->delete();

        $user->tokens()->get()->each(function (PersonalAccessToken $token) {
            if ($token->can('client:desktop')) {
                $token->delete();
            } elseif (! $token->can('client:web')) {
                // Legacy agent tokens (pre client-tag) — treat as desktop.
                $token->delete();
            }
        });
    }

    public function clientForToken(PersonalAccessToken $token): string
    {
        if ($token->can('client:desktop') || str_starts_with($token->name, 'desktop_')) {
            return self::CLIENT_DESKTOP;
        }

        return self::CLIENT_WEB;
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
