<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\InvitationController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — v1
|--------------------------------------------------------------------------
*/

Route::prefix('v1')->group(function () {

    // Public auth routes
    Route::prefix('auth')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login']);
        Route::post('forgot-password', [AuthController::class, 'forgotPassword']);
        Route::post('reset-password', [AuthController::class, 'resetPassword']);
    });

    // Public invitation acceptance
    Route::post('invitations/accept', [InvitationController::class, 'accept']);

    // Authenticated routes
    Route::middleware('auth:sanctum')->group(function () {

        // Auth
        Route::post('auth/refresh', [AuthController::class, 'refresh']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);

        // Invitations (owner/admin only)
        Route::post('invitations', [InvitationController::class, 'store'])
            ->middleware('role:owner,admin');

        // Timer
        Route::post('timer/start', [\App\Http\Controllers\Api\V1\TimerController::class, 'start']);
        Route::post('timer/stop', [\App\Http\Controllers\Api\V1\TimerController::class, 'stop']);
        Route::post('timer/pause', [\App\Http\Controllers\Api\V1\TimerController::class, 'pause']);
        Route::get('timer/status', [\App\Http\Controllers\Api\V1\TimerController::class, 'status']);
        Route::post('timer/heartbeat', [\App\Http\Controllers\Api\V1\TimerController::class, 'heartbeat']);

        // Time entries
        Route::apiResource('time-entries', \App\Http\Controllers\Api\V1\TimeEntryController::class);
        Route::post('time-entries/{id}/approve', [\App\Http\Controllers\Api\V1\TimeEntryController::class, 'approve']);

        // Timesheets
        Route::post('timesheets/submit', [\App\Http\Controllers\Api\V1\TimesheetController::class, 'submit']);
        Route::post('timesheets/{id}/review', [\App\Http\Controllers\Api\V1\TimesheetController::class, 'review'])
            ->middleware('role:owner,admin,manager');

        // Projects
        Route::apiResource('projects', \App\Http\Controllers\Api\V1\ProjectController::class);

        // Tasks
        Route::apiResource('tasks', \App\Http\Controllers\Api\V1\TaskController::class);

        // Dashboard
        Route::get('dashboard', [\App\Http\Controllers\Api\V1\DashboardController::class, 'index']);

        // Agent
        Route::get('agent/config', [\App\Http\Controllers\Api\V1\AgentController::class, 'config']);
        Route::post('agent/logs', [\App\Http\Controllers\Api\V1\AgentController::class, 'bulkLogs']);

        // Screenshots
        Route::apiResource('screenshots', \App\Http\Controllers\Api\V1\ScreenshotController::class)->only(['index', 'store', 'destroy']);
        Route::get('screenshots/signed-cookies', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'signedCookies']);

        // Reports
        Route::prefix('reports')->group(function () {
            Route::get('summary', [\App\Http\Controllers\Api\V1\ReportController::class, 'summary']);
            Route::get('team', [\App\Http\Controllers\Api\V1\ReportController::class, 'team']);
            Route::get('projects', [\App\Http\Controllers\Api\V1\ReportController::class, 'projects']);
            Route::get('apps', [\App\Http\Controllers\Api\V1\ReportController::class, 'apps']);
            Route::get('timeline', [\App\Http\Controllers\Api\V1\ReportController::class, 'timeline']);
            Route::post('export', [\App\Http\Controllers\Api\V1\ReportController::class, 'export']);
            Route::get('payroll', [\App\Http\Controllers\Api\V1\ReportController::class, 'payroll']);
            Route::get('attendance', [\App\Http\Controllers\Api\V1\ReportController::class, 'attendance']);
        });

        // Job status
        Route::get('jobs/{id}', [\App\Http\Controllers\Api\V1\ReportController::class, 'jobStatus']);

        // Teams (owner/admin/manager)
        Route::apiResource('teams', \App\Http\Controllers\Api\V1\TeamController::class)->middleware('role:owner,admin,manager');
        Route::post('teams/{id}/members', [\App\Http\Controllers\Api\V1\TeamController::class, 'addMember'])->middleware('role:owner,admin,manager');
        Route::delete('teams/{id}/members', [\App\Http\Controllers\Api\V1\TeamController::class, 'removeMember'])->middleware('role:owner,admin,manager');

        // Users (owner/admin/manager)
        Route::apiResource('users', \App\Http\Controllers\Api\V1\UserController::class)->except(['store'])->middleware('role:owner,admin,manager');

        // Settings
        Route::get('settings', [\App\Http\Controllers\Api\V1\SettingsController::class, 'show']);
        Route::put('settings', [\App\Http\Controllers\Api\V1\SettingsController::class, 'update'])->middleware('role:owner,admin');

        // Billing (owner/admin only)
        Route::prefix('billing')->middleware('role:owner,admin')->group(function () {
            Route::post('subscribe', [\App\Http\Controllers\Api\V1\BillingController::class, 'subscribe']);
            Route::post('change-plan', [\App\Http\Controllers\Api\V1\BillingController::class, 'changePlan']);
            Route::post('cancel', [\App\Http\Controllers\Api\V1\BillingController::class, 'cancel']);
            Route::get('invoices', [\App\Http\Controllers\Api\V1\BillingController::class, 'invoices']);
            Route::get('usage', [\App\Http\Controllers\Api\V1\BillingController::class, 'usage']);
        });
    });

    // Stripe webhook (no auth — verified by signature)
    Route::post('webhooks/stripe', [\App\Http\Controllers\Api\V1\WebhookController::class, 'stripe']);
});
