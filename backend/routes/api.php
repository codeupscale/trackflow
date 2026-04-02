<?php

use App\Http\Controllers\Api\V1\AuditLogController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DataPrivacyController;
use App\Http\Controllers\Api\V1\Hr\AttendanceController;
use App\Http\Controllers\Api\V1\Hr\AttendanceRegularizationController;
use App\Http\Controllers\Api\V1\Hr\DepartmentController;
use App\Http\Controllers\Api\V1\Hr\EmployeeController;
use App\Http\Controllers\Api\V1\Hr\EmployeeDocumentController;
use App\Http\Controllers\Api\V1\Hr\EmployeeNoteController;
use App\Http\Controllers\Api\V1\Hr\LeaveBalanceController;
use App\Http\Controllers\Api\V1\Hr\LeaveCalendarController;
use App\Http\Controllers\Api\V1\Hr\LeaveRequestController;
use App\Http\Controllers\Api\V1\Hr\LeaveTypeController;
use App\Http\Controllers\Api\V1\Hr\OvertimeRuleController;
use App\Http\Controllers\Api\V1\Hr\PositionController;
use App\Http\Controllers\Api\V1\Hr\PublicHolidayController;
use App\Http\Controllers\Api\V1\Hr\PayComponentController;
use App\Http\Controllers\Api\V1\Hr\PayrollPeriodController;
use App\Http\Controllers\Api\V1\Hr\PayslipController;
use App\Http\Controllers\Api\V1\Hr\SalaryStructureController;
use App\Http\Controllers\Api\V1\Hr\EmployeeSalaryController;
use App\Http\Controllers\Api\V1\Hr\ShiftAssignmentController;
use App\Http\Controllers\Api\V1\Hr\ShiftController;
use App\Http\Controllers\Api\V1\Hr\ShiftSwapController;
use App\Http\Controllers\Api\V1\InvitationController;
use App\Http\Controllers\Api\V1\JobMonitorController;
use App\Http\Controllers\Api\V1\PermissionController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\RoleController;
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

        // Invitations
        Route::get('invitations', [InvitationController::class, 'index'])
            ->middleware('permission:team.invite');
        Route::post('invitations', [InvitationController::class, 'store'])
            ->middleware('permission:team.invite');
        Route::post('invitations/{id}/resend', [InvitationController::class, 'resend'])
            ->middleware('permission:team.invite');
        Route::delete('invitations/{id}', [InvitationController::class, 'destroy'])
            ->middleware('permission:team.invite');
        // Backward-compatible alias used by older frontend builds
        Route::post('users/invite', [InvitationController::class, 'store'])
            ->middleware('permission:team.invite');

        // Timer (desktop safety — auth:sanctum only)
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
            ->middleware('permission:time_entries.approve');

        // Projects
        Route::apiResource('projects', \App\Http\Controllers\Api\V1\ProjectController::class);
        Route::get('projects/{project}/members', [\App\Http\Controllers\Api\V1\ProjectController::class, 'members'])
            ->middleware('permission:projects.manage_members');
        Route::put('projects/{project}/members', [\App\Http\Controllers\Api\V1\ProjectController::class, 'syncMembers'])
            ->middleware('permission:projects.manage_members');
        Route::delete('projects/{project}/members/{user}', [\App\Http\Controllers\Api\V1\ProjectController::class, 'removeMember'])
            ->middleware('permission:projects.manage_members')
            ->name('projects.members.remove');

        // Tasks
        Route::apiResource('tasks', \App\Http\Controllers\Api\V1\TaskController::class);

        // Dashboard
        Route::get('dashboard', [\App\Http\Controllers\Api\V1\DashboardController::class, 'index']);

        // Agent (desktop safety — auth:sanctum only)
        Route::get('agent/config', [\App\Http\Controllers\Api\V1\AgentController::class, 'config']);
        Route::post('agent/logs', [\App\Http\Controllers\Api\V1\AgentController::class, 'bulkLogs'])->middleware('throttle:30,1');

        // Screenshots (store + signed-cookies are desktop safety — auth:sanctum only)
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

        // Teams
        Route::apiResource('teams', \App\Http\Controllers\Api\V1\TeamController::class)->middleware('permission:team.view_members');
        Route::post('teams/{id}/members', [\App\Http\Controllers\Api\V1\TeamController::class, 'addMember'])->middleware('permission:team.view_members');
        Route::delete('teams/{id}/members', [\App\Http\Controllers\Api\V1\TeamController::class, 'removeMember'])->middleware('permission:team.view_members');

        // Users
        Route::apiResource('users', \App\Http\Controllers\Api\V1\UserController::class)->except(['store'])->middleware('permission:team.view_members');
        Route::post('users/{id}/password-reset', [UserPasswordController::class, 'reset'])
            ->middleware(['permission:team.change_role', 'throttle:5,1']);

        // Settings
        Route::get('settings', [\App\Http\Controllers\Api\V1\SettingsController::class, 'show']);
        Route::put('settings', [\App\Http\Controllers\Api\V1\SettingsController::class, 'update'])->middleware('permission:settings.edit_org');

        // Job Monitoring
        Route::get('jobs/health', [JobMonitorController::class, 'health'])
            ->middleware('permission:settings.view_org');
        Route::post('jobs/retry/{id}', [JobMonitorController::class, 'retry'])
            ->middleware('permission:settings.edit_org');

        // Billing
        Route::prefix('billing')->middleware('permission:settings.manage_billing')->group(function () {
            Route::post('subscribe', [\App\Http\Controllers\Api\V1\BillingController::class, 'subscribe']);
            Route::post('change-plan', [\App\Http\Controllers\Api\V1\BillingController::class, 'changePlan']);
            Route::post('cancel', [\App\Http\Controllers\Api\V1\BillingController::class, 'cancel']);
            Route::get('invoices', [\App\Http\Controllers\Api\V1\BillingController::class, 'invoices']);
            Route::get('usage', [\App\Http\Controllers\Api\V1\BillingController::class, 'usage']);
        });

        // --- Enterprise Features ---

        // Audit Logs
        Route::prefix('audit-logs')->middleware('permission:audit_logs.view')->group(function () {
            Route::get('/', [AuditLogController::class, 'index']);
            Route::get('actions', [AuditLogController::class, 'actions']);
        });

        // SSO Configuration
        Route::prefix('sso')->middleware('permission:settings.edit_org')->group(function () {
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
            Route::get('leave-types', [LeaveTypeController::class, 'index']);
            Route::post('leave-types', [LeaveTypeController::class, 'store'])
                ->middleware('permission:leave.manage_types');
            Route::put('leave-types/{leave_type}', [LeaveTypeController::class, 'update'])
                ->middleware('permission:leave.manage_types');
            Route::apiResource('leave-requests', LeaveRequestController::class)->except(['update']);
            Route::put('leave-requests/{leaveRequest}/approve', [LeaveRequestController::class, 'approve']);
            Route::put('leave-requests/{leaveRequest}/reject', [LeaveRequestController::class, 'reject']);
            Route::get('public-holidays', [PublicHolidayController::class, 'index']);
            Route::post('public-holidays', [PublicHolidayController::class, 'store'])
                ->middleware('permission:leave.manage_holidays');
            Route::delete('public-holidays/{public_holiday}', [PublicHolidayController::class, 'destroy'])
                ->middleware('permission:leave.manage_holidays');

            // Attendance
            Route::get('attendance', [AttendanceController::class, 'index']);
            Route::get('attendance/team', [AttendanceController::class, 'teamIndex']);
            Route::get('attendance/summary', [AttendanceController::class, 'summary']);
            Route::post('attendance/generate', [AttendanceController::class, 'store'])
                ->middleware('permission:attendance.generate');

            // Attendance Regularizations
            Route::get('attendance/regularizations', [AttendanceRegularizationController::class, 'index']);
            Route::post('attendance/{record}/regularize', [AttendanceRegularizationController::class, 'store']);
            Route::put('attendance/regularizations/{id}/approve', [AttendanceRegularizationController::class, 'approve']);
            Route::put('attendance/regularizations/{id}/reject', [AttendanceRegularizationController::class, 'reject']);

            // Overtime Rules
            Route::get('overtime-rules', [OvertimeRuleController::class, 'show']);
            Route::put('overtime-rules', [OvertimeRuleController::class, 'update'])
                ->middleware('permission:attendance.manage_overtime_rules');

            // Employee Directory & Profiles
            Route::get('employees', [EmployeeController::class, 'index']);
            Route::get('employees/{employee}', [EmployeeController::class, 'show']);
            Route::put('employees/{employee}/profile', [EmployeeController::class, 'updateProfile']);

            // Employee Documents
            Route::get('employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
            Route::post('employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);
            Route::delete('employees/{employee}/documents/{document}', [EmployeeDocumentController::class, 'destroy']);
            Route::put('employees/{employee}/documents/{document}/verify', [EmployeeDocumentController::class, 'verify']);

            // Employee Notes
            Route::get('employees/{employee}/notes', [EmployeeNoteController::class, 'index']);
            Route::post('employees/{employee}/notes', [EmployeeNoteController::class, 'store']);
            Route::delete('employees/{employee}/notes/{note}', [EmployeeNoteController::class, 'destroy']);

            // Shifts
            Route::get('shifts', [ShiftController::class, 'index']);
            Route::post('shifts', [ShiftController::class, 'store']);
            Route::get('shifts/roster', [ShiftController::class, 'roster']);
            Route::get('shifts/{shift}', [ShiftController::class, 'show']);
            Route::put('shifts/{shift}', [ShiftController::class, 'update']);
            Route::delete('shifts/{shift}', [ShiftController::class, 'destroy']);

            // Shift Assignments
            Route::get('shifts/{shift}/assignments', [ShiftAssignmentController::class, 'index']);
            Route::post('shifts/{shift}/assign', [ShiftAssignmentController::class, 'assign']);
            Route::post('shifts/{shift}/unassign', [ShiftAssignmentController::class, 'unassign']);
            Route::post('shifts/{shift}/bulk-assign', [ShiftAssignmentController::class, 'bulkAssign']);

            // Shift Swaps
            Route::get('shift-swaps', [ShiftSwapController::class, 'index']);
            Route::post('shift-swaps', [ShiftSwapController::class, 'store']);
            Route::put('shift-swaps/{shiftSwapRequest}/approve', [ShiftSwapController::class, 'approve']);
            Route::put('shift-swaps/{shiftSwapRequest}/reject', [ShiftSwapController::class, 'reject']);
            Route::delete('shift-swaps/{shiftSwapRequest}', [ShiftSwapController::class, 'destroy']);

            // Payroll — Salary Structures
            Route::get('salary-structures', [SalaryStructureController::class, 'index'])
                ->middleware('permission:payroll.manage_structures');
            Route::post('salary-structures', [SalaryStructureController::class, 'store'])
                ->middleware('permission:payroll.manage_structures');
            Route::get('salary-structures/{id}', [SalaryStructureController::class, 'show'])
                ->middleware('permission:payroll.manage_structures');
            Route::put('salary-structures/{id}', [SalaryStructureController::class, 'update'])
                ->middleware('permission:payroll.manage_structures');
            Route::delete('salary-structures/{id}', [SalaryStructureController::class, 'destroy'])
                ->middleware('permission:payroll.manage_structures');

            // Payroll — Pay Components
            Route::get('pay-components', [PayComponentController::class, 'index'])
                ->middleware('permission:payroll.manage_components');
            Route::post('pay-components', [PayComponentController::class, 'store'])
                ->middleware('permission:payroll.manage_components');
            Route::get('pay-components/{id}', [PayComponentController::class, 'show'])
                ->middleware('permission:payroll.manage_components');
            Route::put('pay-components/{id}', [PayComponentController::class, 'update'])
                ->middleware('permission:payroll.manage_components');
            Route::delete('pay-components/{id}', [PayComponentController::class, 'destroy'])
                ->middleware('permission:payroll.manage_components');

            // Payroll — Periods
            Route::get('payroll-periods', [PayrollPeriodController::class, 'index'])
                ->middleware('permission:payroll.view_all');
            Route::post('payroll-periods', [PayrollPeriodController::class, 'store'])
                ->middleware('permission:payroll.run');
            Route::get('payroll-periods/{id}', [PayrollPeriodController::class, 'show'])
                ->middleware('permission:payroll.view_all');
            Route::put('payroll-periods/{id}', [PayrollPeriodController::class, 'update'])
                ->middleware('permission:payroll.run');
            Route::delete('payroll-periods/{id}', [PayrollPeriodController::class, 'destroy'])
                ->middleware('permission:payroll.run');
            Route::post('payroll-periods/{id}/run', [PayrollPeriodController::class, 'run'])
                ->middleware('permission:payroll.run');
            Route::post('payroll-periods/{id}/approve', [PayrollPeriodController::class, 'approve'])
                ->middleware('permission:payroll.approve');

            // Payroll — Payslips
            Route::get('payslips', [PayslipController::class, 'index']);
            Route::get('payslips/{id}', [PayslipController::class, 'show']);

            // Payroll — Employee Salary
            Route::get('employees/{employee}/salary', [EmployeeSalaryController::class, 'show']);
            Route::post('employees/{employee}/salary', [EmployeeSalaryController::class, 'store'])
                ->middleware('permission:payroll.manage_structures');
        });

        // Roles & Permissions
        Route::get('roles', [RoleController::class, 'index'])
            ->middleware('permission:roles.view');
        Route::get('roles/{role}', [RoleController::class, 'show'])
            ->middleware('permission:roles.view');
        Route::post('roles', [RoleController::class, 'store'])
            ->middleware('permission:roles.create');
        Route::put('roles/{role}', [RoleController::class, 'update'])
            ->middleware('permission:roles.edit');
        Route::delete('roles/{role}', [RoleController::class, 'destroy'])
            ->middleware('permission:roles.delete');
        Route::put('users/{user}/role', [RoleController::class, 'assignRole'])
            ->middleware('permission:team.change_role');
        Route::get('permissions', [PermissionController::class, 'index'])
            ->middleware('permission:roles.view');
    });

    // Stripe webhook (no auth — verified by signature)
    Route::post('webhooks/stripe', [\App\Http\Controllers\Api\V1\WebhookController::class, 'stripe']);
});
