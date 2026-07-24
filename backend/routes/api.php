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
        // 'min.agent' blocks outdated desktop builds at login (when TIMER_MIN_AGENT_VERSION is set).
        Route::post('login', [AuthController::class, 'login'])->middleware('min.agent');
        Route::post('forgot-password', [AuthController::class, 'forgotPassword']);
        Route::post('reset-password', [AuthController::class, 'resetPassword']);
        Route::post('google', [AuthController::class, 'googleAuth'])->middleware('min.agent');
        Route::post('select-organization', [AuthController::class, 'selectOrganization'])->middleware('min.agent');
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
        Route::post('auth/refresh', [AuthController::class, 'refresh'])->middleware('min.agent');
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me'])->middleware('min.agent');
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
        //
        // Throttled at 30/min: far above any legitimate use (a human starts and
        // stops a handful of times an hour, and an offline reconcile pushes one
        // start + one stop), but it caps how fast a scripted client can mint
        // back-dated entries. Deliberately generous — a throttle that blocked a
        // real stop would leave the timer running, which is the worse failure.
        // 'min.agent' refuses desktop builds older than TIMER_MIN_AGENT_VERSION
        // (disabled until that env var is set). Gating START is what forces an
        // upgrade: an old build simply cannot begin a session, so it never
        // reaches the idle popup at all.
        //
        // Deliberately NOT on stop / idle. The desktop's idle catch treats ANY
        // error from POST /timer/idle as a network error: it queues the payload
        // and RESUMES the timer, which credits the idle time. Gating those routes
        // would therefore turn a rejection into "idle time kept" on older builds —
        // the exact opposite of the policy — and would break the honest Discard
        // path too. Same reasoning for stop: refusing it strands the entry open
        // and inflates it.
        Route::post('timer/start', [\App\Http\Controllers\Api\V1\TimerController::class, 'start'])->middleware(['throttle:30,1', 'min.agent']);
        Route::post('timer/stop', [\App\Http\Controllers\Api\V1\TimerController::class, 'stop'])->middleware('throttle:30,1');
        Route::post('timer/switch', [\App\Http\Controllers\Api\V1\TimerController::class, 'switch'])->middleware(['throttle:30,1', 'min.agent']);
        Route::post('timer/pause', [\App\Http\Controllers\Api\V1\TimerController::class, 'pause']);
        Route::post('timer/resume', [\App\Http\Controllers\Api\V1\TimerController::class, 'resume']);
        Route::get('timer/status', [\App\Http\Controllers\Api\V1\TimerController::class, 'status']);
        Route::get('timer/today-total', [\App\Http\Controllers\Api\V1\TimerController::class, 'todayTotal']);
        Route::post('timer/heartbeat', [\App\Http\Controllers\Api\V1\TimerController::class, 'heartbeat'])->middleware('throttle:60,1');
        Route::post('timer/idle', [\App\Http\Controllers\Api\V1\TimerController::class, 'idle'])->middleware('throttle:30,1');

        // Time entries
        // STATIC route registered BEFORE the apiResource wildcard so 'pending' is
        // never captured as a {time_entry} id by the show route.
        Route::get('time-entries/pending', [\App\Http\Controllers\Api\V1\TimeEntryController::class, 'pending'])
            ->middleware('permission:time_entries.approve');
        Route::middleware('permission:time_entries.view')->group(function () {
            Route::apiResource('time-entries', \App\Http\Controllers\Api\V1\TimeEntryController::class);
        });
        Route::post('time-entries/{id}/approve', [\App\Http\Controllers\Api\V1\TimeEntryController::class, 'approve'])
            ->middleware('permission:time_entries.approve');
        Route::post('time-entries/{id}/reject', [\App\Http\Controllers\Api\V1\TimeEntryController::class, 'reject'])
            ->middleware('permission:time_entries.approve');

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
        Route::get('dashboard', [\App\Http\Controllers\Api\V1\DashboardController::class, 'index'])
            ->middleware('permission:dashboard.view_own_stats');

        // Agent (desktop safety — auth:sanctum only)
        Route::get('agent/config', [\App\Http\Controllers\Api\V1\AgentController::class, 'config'])->middleware('min.agent');
        Route::get('agent/my-shift', [\App\Http\Controllers\Api\V1\AgentController::class, 'myShift']);
        Route::post('agent/logs', [\App\Http\Controllers\Api\V1\AgentController::class, 'bulkLogs'])->middleware('throttle:30,1');

        // Screenshots
        Route::get('screenshots/signed-cookies', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'signedCookies'])
            ->middleware('permission:screenshots.view');
        Route::post('screenshots/presign', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'presign'])->middleware('throttle:60,1');
        Route::post('screenshots/confirm', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'confirm'])->middleware('throttle:60,1');
        Route::get('screenshots', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'index'])
            ->middleware('permission:screenshots.view');
        Route::delete('screenshots/{screenshot}', [\App\Http\Controllers\Api\V1\ScreenshotController::class, 'destroy'])
            ->middleware('permission:screenshots.delete');

        // Reports
        Route::prefix('reports')->middleware('permission:reports.view')->group(function () {
            Route::get('summary', [\App\Http\Controllers\Api\V1\ReportController::class, 'summary']);
            Route::get('team', [\App\Http\Controllers\Api\V1\ReportController::class, 'team']);
            Route::get('projects', [\App\Http\Controllers\Api\V1\ReportController::class, 'projects']);
            Route::get('apps', [\App\Http\Controllers\Api\V1\ReportController::class, 'apps']);
            Route::get('timeline', [\App\Http\Controllers\Api\V1\ReportController::class, 'timeline']);
            Route::post('export', [\App\Http\Controllers\Api\V1\ReportController::class, 'export'])
                ->middleware(['permission:reports.export', 'throttle:10,60'])->withoutMiddleware('permission:reports.view');
            Route::get('analytics', [\App\Http\Controllers\Api\V1\ReportController::class, 'analytics']);
            Route::get('detailed-logs', [\App\Http\Controllers\Api\V1\ReportController::class, 'detailedLogs']);
            Route::get('activity-by-day', [\App\Http\Controllers\Api\V1\ReportController::class, 'activityByDay']);
            Route::get('time-logs', [\App\Http\Controllers\Api\V1\ReportController::class, 'timeLogs']);
            Route::get('payroll', [\App\Http\Controllers\Api\V1\ReportController::class, 'payroll']);
            Route::get('attendance', [\App\Http\Controllers\Api\V1\ReportController::class, 'attendance']);

            // Project-manager time report (filters + CSV/PDF export). The export
            // route swaps reports.view for reports.export + a tighter throttle.
            Route::get('project-time', [\App\Http\Controllers\Api\V1\ProjectTimeReportController::class, 'index']);
            Route::get('project-time/export', [\App\Http\Controllers\Api\V1\ProjectTimeReportController::class, 'export'])
                ->middleware(['permission:reports.export', 'throttle:10,60'])
                ->withoutMiddleware('permission:reports.view');
        });

        // App Usage
        Route::prefix('app-usage')->middleware('permission:reports.view')->group(function () {
            Route::get('daily', [\App\Http\Controllers\Api\V1\AppUsageController::class, 'daily']);
            Route::get('team', [\App\Http\Controllers\Api\V1\AppUsageController::class, 'team']);
            Route::get('top', [\App\Http\Controllers\Api\V1\AppUsageController::class, 'top']);
            Route::get('export', [\App\Http\Controllers\Api\V1\AppUsageController::class, 'export'])
                ->middleware(['permission:reports.export', 'throttle:10,60'])
                ->withoutMiddleware('permission:reports.view');
        });

        // Report Subscriptions
        Route::apiResource('report-subscriptions', \App\Http\Controllers\Api\V1\ReportSubscriptionController::class)
            ->only(['index', 'store', 'destroy']);

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
        Route::get('settings', [\App\Http\Controllers\Api\V1\SettingsController::class, 'show'])
            ->middleware('permission:settings.view_org');
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
            Route::get('departments/tree', [DepartmentController::class, 'tree'])
                ->middleware('permission:departments.view');
            Route::apiResource('departments', DepartmentController::class)
                ->middleware('permission:departments.view');
            Route::apiResource('positions', PositionController::class)
                ->middleware('permission:positions.view');

            // Leave Management
            Route::get('leave-calendar', [LeaveCalendarController::class, 'index'])
                ->middleware('permission:leave.view_calendar');
            Route::get('leave-balances', [LeaveBalanceController::class, 'index'])
                ->middleware('permission:leave.apply');
            Route::get('leave-types', [LeaveTypeController::class, 'index'])
                ->middleware('permission:leave.apply');
            Route::post('leave-types', [LeaveTypeController::class, 'store'])
                ->middleware('permission:leave.manage_types');
            Route::put('leave-types/{leave_type}', [LeaveTypeController::class, 'update'])
                ->middleware('permission:leave.manage_types');
            Route::apiResource('leave-requests', LeaveRequestController::class)
                ->except(['update'])
                ->middleware('permission:leave.apply');
            Route::put('leave-requests/{leaveRequest}/approve', [LeaveRequestController::class, 'approve'])
                ->middleware('permission:leave.approve');
            Route::put('leave-requests/{leaveRequest}/reject', [LeaveRequestController::class, 'reject'])
                ->middleware('permission:leave.approve');
            Route::get('public-holidays', [PublicHolidayController::class, 'index'])
                ->middleware('permission:leave.apply');
            Route::post('public-holidays', [PublicHolidayController::class, 'store'])
                ->middleware('permission:leave.manage_holidays');
            Route::delete('public-holidays/{public_holiday}', [PublicHolidayController::class, 'destroy'])
                ->middleware('permission:leave.manage_holidays');

            // Attendance
            Route::get('attendance', [AttendanceController::class, 'index'])
                ->middleware('permission:attendance.view');
            Route::get('attendance/team', [AttendanceController::class, 'teamIndex'])
                ->middleware('permission:attendance.view,project');
            Route::get('attendance/summary', [AttendanceController::class, 'summary'])
                ->middleware('permission:attendance.view');
            Route::post('attendance/generate', [AttendanceController::class, 'store'])
                ->middleware('permission:attendance.generate');

            // Check-in / Checkout (self-service). STATIC routes MUST be declared
            // before the attendance/{record}/... wildcard to avoid route-model-binding
            // collision (e.g. 'check-in' being captured as a {record} id).
            Route::post('attendance/check-in', [AttendanceController::class, 'checkIn'])
                ->middleware('permission:attendance.check_in');
            Route::post('attendance/check-out', [AttendanceController::class, 'checkOut'])
                ->middleware('permission:attendance.check_in');
            Route::get('attendance/today', [AttendanceController::class, 'todayStatus'])
                ->middleware('permission:attendance.check_in');
            Route::get('attendance/check-ins', [AttendanceController::class, 'checkInsIndex'])
                ->middleware('permission:attendance.view');
            Route::get('attendance/check-ins/summary', [AttendanceController::class, 'checkInsSummary'])
                ->middleware('permission:attendance.view');
            Route::get('attendance/check-ins/export', [AttendanceController::class, 'checkInsExport'])
                ->middleware('permission:attendance.export');

            // Attendance Regularizations
            Route::get('attendance/regularizations', [AttendanceRegularizationController::class, 'index'])
                ->middleware('permission:attendance.view');
            Route::post('attendance/{record}/regularize', [AttendanceRegularizationController::class, 'store'])
                ->middleware('permission:attendance.regularize');
            Route::put('attendance/regularizations/{id}/approve', [AttendanceRegularizationController::class, 'approve'])
                ->middleware('permission:attendance.approve_regularizations');
            Route::put('attendance/regularizations/{id}/reject', [AttendanceRegularizationController::class, 'reject'])
                ->middleware('permission:attendance.approve_regularizations');

            // Overtime Rules
            Route::get('overtime-rules', [OvertimeRuleController::class, 'show'])
                ->middleware('permission:attendance.view');
            Route::put('overtime-rules', [OvertimeRuleController::class, 'update'])
                ->middleware('permission:attendance.manage_overtime_rules');

            // Employee Directory & Profiles
            Route::get('employees', [EmployeeController::class, 'index'])
                ->middleware('permission:employees.view_directory');
            Route::get('employees/{employee}', [EmployeeController::class, 'show'])
                ->middleware('permission:employees.view_profile');
            Route::put('employees/{employee}/profile', [EmployeeController::class, 'updateProfile'])
                ->middleware('permission:employees.edit_profile');

            // Employee Documents
            Route::get('employees/{employee}/documents', [EmployeeDocumentController::class, 'index'])
                ->middleware('permission:employees.manage_documents');
            Route::post('employees/{employee}/documents', [EmployeeDocumentController::class, 'store'])
                ->middleware('permission:employees.manage_documents');
            Route::delete('employees/{employee}/documents/{document}', [EmployeeDocumentController::class, 'destroy'])
                ->middleware('permission:employees.manage_documents');
            Route::put('employees/{employee}/documents/{document}/verify', [EmployeeDocumentController::class, 'verify'])
                ->middleware('permission:employees.manage_documents');

            // Employee Notes
            Route::get('employees/{employee}/notes', [EmployeeNoteController::class, 'index'])
                ->middleware('permission:employees.manage_notes');
            Route::post('employees/{employee}/notes', [EmployeeNoteController::class, 'store'])
                ->middleware('permission:employees.manage_notes');
            Route::delete('employees/{employee}/notes/{note}', [EmployeeNoteController::class, 'destroy'])
                ->middleware('permission:employees.manage_notes');

            // Shifts
            Route::get('shifts', [ShiftController::class, 'index'])
                ->middleware('permission:shifts.view');
            Route::post('shifts', [ShiftController::class, 'store'])
                ->middleware('permission:shifts.create');
            Route::get('shifts/roster', [ShiftController::class, 'roster'])
                ->middleware('permission:shifts.view');
            Route::get('shifts/{shift}', [ShiftController::class, 'show'])
                ->middleware('permission:shifts.view');
            Route::put('shifts/{shift}', [ShiftController::class, 'update'])
                ->middleware('permission:shifts.edit');
            Route::delete('shifts/{shift}', [ShiftController::class, 'destroy'])
                ->middleware('permission:shifts.delete');

            // Shift Assignments
            Route::get('shifts/{shift}/assignments', [ShiftAssignmentController::class, 'index'])
                ->middleware('permission:shifts.manage_assignments');
            Route::post('shifts/{shift}/assign', [ShiftAssignmentController::class, 'assign'])
                ->middleware('permission:shifts.manage_assignments');
            Route::post('shifts/{shift}/unassign', [ShiftAssignmentController::class, 'unassign'])
                ->middleware('permission:shifts.manage_assignments');
            Route::post('shifts/{shift}/bulk-assign', [ShiftAssignmentController::class, 'bulkAssign'])
                ->middleware('permission:shifts.manage_assignments');

            // Shift Swaps
            Route::get('shift-swaps', [ShiftSwapController::class, 'index'])
                ->middleware('permission:shifts.view');
            Route::post('shift-swaps', [ShiftSwapController::class, 'store'])
                ->middleware('permission:shifts.view');
            Route::put('shift-swaps/{shiftSwapRequest}/approve', [ShiftSwapController::class, 'approve'])
                ->middleware('permission:shifts.manage_swaps');
            Route::put('shift-swaps/{shiftSwapRequest}/reject', [ShiftSwapController::class, 'reject'])
                ->middleware('permission:shifts.manage_swaps');
            Route::delete('shift-swaps/{shiftSwapRequest}', [ShiftSwapController::class, 'destroy'])
                ->middleware('permission:shifts.view');

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
            Route::get('payslips', [PayslipController::class, 'index'])
                ->middleware('permission:payroll.view_own');
            Route::get('payslips/{id}', [PayslipController::class, 'show'])
                ->middleware('permission:payroll.view_own');

            // Payroll — Employee Salary
            Route::get('employees/{employee}/salary', [EmployeeSalaryController::class, 'show'])
                ->middleware('permission:payroll.view_all');
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
