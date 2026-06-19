<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Sanctum token lifecycle with client-aware sessions.
 *
 * - Web: multiple browser sessions allowed.
 * - Desktop: exactly one machine at a time — a second desktop login is rejected (409)
 *   while another desktop session or an open timer exists for the account.
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
     * Reject desktop login when another machine holds the session or a timer is running.
     */
    public function assertDesktopLoginAllowed(User $user, string $deviceId): void
    {
        if ($this->timerService->userHasOpenTimer($user)) {
            $timerDeviceId = $this->primaryDesktopDeviceId($user);

            if ($timerDeviceId !== null && $timerDeviceId !== $deviceId) {
                throw new HttpException(
                    409,
                    'A timer is running on another desktop. Stop the timer and log out there before signing in here.'
                );
            }

            if ($timerDeviceId === null) {
                throw new HttpException(
                    409,
                    'A timer is already running for this account on another desktop.'
                );
            }
        }

        foreach ($this->getActiveDesktopTokens($user) as $token) {
            $tokenDeviceId = $this->tokenDeviceId($token);

            if ($tokenDeviceId === null || $tokenDeviceId !== $deviceId) {
                throw new HttpException(
                    409,
                    'This account is already logged in on another desktop computer. Log out there first.'
                );
            }
        }
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
        if ($token->can('client:web')) {
            return false;
        }

        if ($token->can('client:desktop') || str_starts_with($token->name, 'desktop_')) {
            return true;
        }

        // Legacy desktop agent tokens (pre client-tag) used access_token / refresh_token names.
        return in_array($token->name, ['access_token', 'refresh_token'], true);
    }

    /**
     * @return list<PersonalAccessToken>
     */
    private function getActiveDesktopTokens(User $user): array
    {
        return $user->tokens()
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->get()
            ->filter(fn (PersonalAccessToken $token) => $this->isDesktopToken($token))
            ->values()
            ->all();
    }

    private function primaryDesktopDeviceId(User $user): ?string
    {
        foreach ($this->getActiveDesktopTokens($user) as $token) {
            $deviceId = $this->tokenDeviceId($token);
            if ($deviceId !== null) {
                return $deviceId;
            }
        }

        return null;
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
