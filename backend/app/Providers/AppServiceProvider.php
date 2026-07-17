<?php

namespace App\Providers;

use App\Events\TimerStarted;
use App\Listeners\AutoCheckInOnTimerStart;
use App\Services\PermissionService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(PermissionService::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Password reset links point to the frontend, not the backend
        ResetPassword::createUrlUsing(function ($user, string $token) {
            $frontendUrl = rtrim(config('app.frontend_url', config('app.url')), '/');
            return $frontendUrl . '/reset-password?' . http_build_query([
                'token' => $token,
                'email' => $user->getEmailForPasswordReset(),
            ]);
        });

        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(config('security.rate_limits.api'))->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(config('security.rate_limits.auth'))->by($request->ip());
        });

        // Auto check-in on first timer start of the day (per-org opt-in). Registered
        // explicitly rather than relying on listener auto-discovery.
        Event::listen(TimerStarted::class, AutoCheckInOnTimerStart::class);
    }
}
