<?php

use App\Http\Middleware\CheckPermission;
use App\Http\Middleware\CheckSeatLimit;
use App\Http\Middleware\CheckTrialExpired;
use App\Http\Middleware\RequestId;
use App\Http\Middleware\RoleMiddleware;
use App\Http\Middleware\SanitizeInput;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\ThrottleRequestsException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        apiPrefix: 'api',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role' => RoleMiddleware::class,
            'permission' => CheckPermission::class,
            'check.trial' => CheckTrialExpired::class,
            'check.seats' => CheckSeatLimit::class,
        ]);

        // Global middleware
        $middleware->append(SecurityHeaders::class);
        $middleware->append(RequestId::class);

        // API middleware
        $middleware->api(append: [
            SanitizeInput::class,
        ]);

        // Rate limiting for API
        $middleware->throttleApi('1000,1');

        // Stricter rate limiting for auth routes
        $middleware->throttle('auth:10,1');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Consistent JSON error responses for API
        $exceptions->render(function (Throwable $e, Request $request) {
            if (!$request->is('api/*') && !$request->expectsJson()) {
                return null;
            }

            $status = 500;
            $error = [
                'code' => 'internal_error',
                'message' => 'An unexpected error occurred.',
            ];

            if ($e instanceof ValidationException) {
                $status = 422;
                $error = [
                    'code' => 'validation_error',
                    'message' => 'The given data was invalid.',
                    'details' => $e->errors(),
                ];
            } elseif ($e instanceof ModelNotFoundException) {
                $status = 404;
                $error = [
                    'code' => 'not_found',
                    'message' => 'The requested resource was not found.',
                ];
            } elseif ($e instanceof ThrottleRequestsException) {
                $status = 429;
                $error = [
                    'code' => 'rate_limited',
                    'message' => 'Too many requests. Please try again later.',
                    'retry_after' => $e->getHeaders()['Retry-After'] ?? null,
                ];
            } elseif ($e instanceof HttpException) {
                $status = $e->getStatusCode();
                $error = [
                    'code' => match ($status) {
                        401 => 'unauthenticated',
                        403 => 'forbidden',
                        404 => 'not_found',
                        405 => 'method_not_allowed',
                        default => 'http_error',
                    },
                    'message' => $e->getMessage() ?: 'An error occurred.',
                ];
            }

            if (app()->environment('local', 'testing') && $status === 500) {
                $error['debug'] = [
                    'exception' => get_class($e),
                    'message' => $e->getMessage(),
                    'file' => $e->getFile() . ':' . $e->getLine(),
                ];
            }

            return response()->json(['error' => $error], $status);
        });
    })->create();
