<?php

use App\Http\Controllers\Api\V1\AuditLogController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DataPrivacyController;
use App\Http\Controllers\Api\V1\Hr\DepartmentController;
use App\Http\Controllers\Api\V1\Hr\LeaveBalanceController;
use App\Http\Controllers\Api\V1\Hr\LeaveCalendarController;
use App\Http\Controllers\Api\V1\Hr\LeaveRequestController;
use App\Http\Controllers\Api\V1\Hr\LeaveTypeController;
use App\Http\Controllers\Api\V1\Hr\PositionController;
use App\Http\Controllers\Api\V1\Hr\PublicHolidayController;
use App\Http\Controllers\Api\V1\InvitationController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\SsoController;
use App\Http\Controllers\Api\V1\UserPasswordController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — v1
|--------------------------------------------------------------------------
*/

Route::prefix('v1')->group(function () {

    // Health checks (public)
    Route::get('health', \App\Http\Controllers\Api\V1\HealthController::class);
    Route::get('health/live', fn () => response()->json(['status' => 'ok']));

    // Public auth routes (with stricter rate limiting)
    Route::prefix('auth')->middleware('throttle:auth')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login']);
        Route::post('forgot-password', [AuthController::class, 'forgotPassword']);
        Route::post('reset-password', [AuthController::class, 'resetPassword']);
        Route::post('google', [AuthController::class, 'googleAuth']);
        Route::post('select-organization', [AuthController::class, 'selectOrganization']);
    });

    // SAML2 SSO endpoints (public — IdP-initiated)
    Route::prefix('auth/saml')->group(function () {
        Route::post('acs', [SsoController::class, 'samlAcs']);
        Route::get('metadata', [SsoController::class, 'metadata']);
    });

    // Public invitation acceptance
    Route::post('invitations/accept', [InvitationController::class, 'accept']);

    // Screenshot file serving (public — access controlled via HMAC signature)
    Route::get('screenshots/{id}/file', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'show']);

    // Authenticated routes
    Route::middleware('auth:sanctum')->group(function () {

        // Profile
        Route::get('profile', [ProfileController::class, 'show']);
        Route::put('profile', [ProfileController::class, 'update']);
        Route::post('profile/avatar', [ProfileController::class, 'uploadAvatar']);

        // Auth
        Route::post('auth/refresh', [AuthController::class, 'refresh']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::patch('auth/me', [AuthController::class, 'updateProfile']);
        Route::post('auth/change-password', [AuthController::class, 'changePassword'])->middleware('throttle:10,1');
        Route::get('auth/organizations', [AuthController::class, 'organizations']);
        Route::post('auth/switch-organization', [AuthController::class, 'switchOrganization']);

        // Invitations (owner/admin/manager)
        Route::get('invitations', [InvitationController::class, 'index'])
            ->middleware('role:owner,admin,manager');
        Route::post('invitations', [InvitationController::class, 'store'])
            ->middleware('role:owner,admin,manager');
        Route::post('invitations/{id}/resend', [InvitationController::class, 'resend'])
            ->middleware('role:owner,admin,manager');
        Route::delete('invitations/{id}', [InvitationController::class, 'destroy'])
            ->middleware('role:owner,admin,manager');
        // Backward-compatible alias used by older frontend builds
        Route::post('users/invite', [InvitationController::class, 'store'])
            ->middleware('role:owner,admin,manager');

        // Timer
        Route::post('timer/start', [\App\Http\Controllers\Api\V1\TimerController::class, 'start']);
        Route::post('timer/stop', [\App\Http\Controllers\Api\V1\TimerController::class, 'stop']);
        Route::post('timer/switch', [\App\Http\Controllers\Api\V1\TimerController::class, 'switch']);
        Route::post('timer/pause', [\App\Http\Controllers\Api\V1\TimerController::class, 'pause']);
        Route::get('timer/status', [\App\Http\Controllers\Api\V1\TimerController::class, 'status']);
        Route::get('timer/today-total', [\App\Http\Controllers\Api\V1\TimerController::class, 'todayTotal']);
        Route::post('timer/heartbeat', [\App\Http\Controllers\Api\V1\TimerController::class, 'heartbeat'])->middleware('throttle:60,1');
        Route::post('timer/idle', [\App\Http\Controllers\Api\V1\TimerController::class, 'idle']);

        // Time entries
        Route::apiResource('time-entries', \App\Http\Controllers\Api\V1\TimeEntryController::class);
        Route::post('time-entries/{id}/approve', [\App\Http\Controllers\Api\V1\TimeEntryController::class, 'approve']);

        // Timesheets
        Route::post('timesheets/submit', [\App\Http\Controllers\Api\V1\TimesheetController::class, 'submit']);
        Route::post('timesheets/{id}/review', [\App\Http\Controllers\Api\V1\TimesheetController::class, 'review'])
            ->middleware('role:owner,admin,manager');

        // Projects
        Route::apiResource('projects', \App\Http\Controllers\Api\V1\ProjectController::class);
        Route::get('projects/{project}/members', [\App\Http\Controllers\Api\V1\ProjectController::class, 'members'])
            ->middleware('role:owner,admin,manager');
        Route::put('projects/{project}/members', [\App\Http\Controllers\Api\V1\ProjectController::class, 'syncMembers'])
            ->middleware('role:owner,admin,manager');
        Route::delete('projects/{project}/members/{user}', [\App\Http\Controllers\Api\V1\ProjectController::class, 'removeMember'])
            ->middleware('role:owner,admin,manager')
            ->name('projects.members.remove');

        // Tasks
        Route::apiResource('tasks', \App\Http\Controllers\Api\V1\TaskController::class);

        // Dashboard
        Route::get('dashboard', [\App\Http\Controllers\Api\V1\DashboardController::class, 'index']);

        // Agent
        Route::get('agent/config', [\App\Http\Controllers\Api\V1\AgentController::class, 'config']);
        Route::post('agent/logs', [\App\Http\Controllers\Api\V1\AgentController::class, 'bulkLogs'])->middleware('throttle:30,1');

        // Screenshots
        Route::get('screenshots/signed-cookies', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'signedCookies']);
        Route::post('screenshots', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'store'])->middleware('throttle:30,1');
        Route::apiResource('screenshots', \App\Http\Controllers\Api\V1\ScreenshotController::class)->only(['index', 'destroy']);

        // Reports
        Route::prefix('reports')->group(function () {
            Route::get('summary', [\App\Http\Controllers\Api\V1\ReportController::class, 'summary']);
            Route::get('team', [\App\Http\Controllers\Api\V1\ReportController::class, 'team']);
            Route::get('projects', [\App\Http\Controllers\Api\V1\ReportController::class, 'projects']);
            Route::get('apps', [\App\Http\Controllers\Api\V1\ReportController::class, 'apps']);
            Route::get('timeline', [\App\Http\Controllers\Api\V1\ReportController::class, 'timeline']);
            Route::post('export', [\App\Http\Controllers\Api\V1\ReportController::class, 'export'])
                ->middleware('throttle:10,60'); // 10 exports per hour
            Route::get('analytics', [\App\Http\Controllers\Api\V1\ReportController::class, 'analytics']);
            Route::get('detailed-logs', [\App\Http\Controllers\Api\V1\ReportController::class, 'detailedLogs']);
            Route::get('activity-by-day', [\App\Http\Controllers\Api\V1\ReportController::class, 'activityByDay']);
            Route::get('time-logs', [\App\Http\Controllers\Api\V1\ReportController::class, 'timeLogs']);
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
        Route::post('users/{id}/password-reset', [UserPasswordController::class, 'reset'])
            ->middleware(['role:owner,admin,manager', 'throttle:5,1']);

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

        // --- Enterprise Features ---

        // Audit Logs (owner/admin only)
        Route::prefix('audit-logs')->middleware('role:owner,admin')->group(function () {
            Route::get('/', [AuditLogController::class, 'index']);
            Route::get('actions', [AuditLogController::class, 'actions']);
        });

        // SSO Configuration (owner/admin only)
        Route::prefix('sso')->middleware('role:owner,admin')->group(function () {
            Route::get('/', [SsoController::class, 'show']);
            Route::put('configure', [SsoController::class, 'configure']);
            Route::delete('/', [SsoController::class, 'destroy']);
        });

        // Data Privacy / GDPR
        Route::prefix('privacy')->group(function () {
            Route::get('export', [DataPrivacyController::class, 'exportData']);
            Route::delete('account', [DataPrivacyController::class, 'deleteAccount']);
            Route::get('data-processing', [DataPrivacyController::class, 'dataProcessingInfo']);
            Route::post('consent', [DataPrivacyController::class, 'recordConsent']);
        });

        // HR - Org Structure
        Route::prefix('hr')->group(function () {
            Route::get('departments/tree', [DepartmentController::class, 'tree']);
            Route::apiResource('departments', DepartmentController::class);
            Route::apiResource('positions', PositionController::class);

            // Leave Management
            Route::get('leave-calendar', [LeaveCalendarController::class, 'index']);
            Route::get('leave-balances', [LeaveBalanceController::class, 'index']);
            Route::apiResource('leave-types', LeaveTypeController::class)->only(['index', 'store']);
            Route::apiResource('leave-requests', LeaveRequestController::class)->except(['update']);
            Route::put('leave-requests/{leaveRequest}/approve', [LeaveRequestController::class, 'approve']);
            Route::put('leave-requests/{leaveRequest}/reject', [LeaveRequestController::class, 'reject']);
            Route::apiResource('public-holidays', PublicHolidayController::class)->only(['index', 'store']);
        });

        // Permissions (owner/admin only)
        Route::prefix('permissions')->middleware('role:owner,admin')->group(function () {
            Route::get('/', function () {
                return response()->json([
                    'permissions' => \App\Models\Permission::all()->groupBy('group'),
                ]);
            });
            Route::get('roles/{role}', function (string $role) {
                return response()->json([
                    'permissions' => \App\Services\PermissionService::getRolePermissions($role),
                ]);
            });
            Route::get('users/{id}/overrides', function (\Illuminate\Http\Request $request, string $id) {
                $user = $request->user()->organization->users()->findOrFail($id);
                return response()->json([
                    'overrides' => \App\Services\PermissionService::getUserOverrides($user),
                ]);
            });
            Route::put('users/{id}/overrides', function (\Illuminate\Http\Request $request, string $id) {
                $request->validate([
                    'permission' => 'required|string|exists:permissions,name',
                    'granted' => 'required|boolean',
                ]);
                $user = $request->user()->organization->users()->findOrFail($id);
                $permission = \App\Models\Permission::where('name', $request->permission)->firstOrFail();

                \Illuminate\Support\Facades\DB::table('user_permission_overrides')->updateOrInsert(
                    ['user_id' => $user->id, 'permission_id' => $permission->id],
                    ['granted' => $request->granted, 'id' => (string) \Illuminate\Support\Str::uuid()],
                );

                \App\Services\PermissionService::clearCache($user);
                \App\Services\AuditService::log('user.permission_override', $user, [
                    'permission' => $request->permission,
                    'granted' => $request->granted,
                ]);

                return response()->json(['message' => 'Permission override saved.']);
            });
        });
    });

    // Stripe webhook (no auth — verified by signature)
    Route::post('webhooks/stripe', [\App\Http\Controllers\Api\V1\WebhookController::class, 'stripe']);
});
