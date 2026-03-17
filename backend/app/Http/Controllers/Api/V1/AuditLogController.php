<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'action' => 'nullable|string|max:100',
            'user_id' => 'nullable|uuid',
            'resource_type' => 'nullable|string|max:100',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
        ]);

        $query = AuditLog::where('organization_id', $request->user()->organization_id)
            ->with('user:id,name,email')
            ->orderBy('created_at', 'desc');

        if ($request->filled('action')) {
            $query->where('action', $request->action);
        }
        if ($request->filled('user_id')) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->filled('resource_type')) {
            $query->where('resource_type', $request->resource_type);
        }
        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', $request->date_from);
        }
        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', $request->date_to);
        }

        $logs = $query->paginate(min((int) $request->input('per_page', 50), 100));

        return response()->json($logs);
    }

    public function actions(): JsonResponse
    {
        return response()->json([
            'actions' => [
                'auth.login', 'auth.login_failed', 'auth.logout', 'auth.register',
                'auth.token_refreshed', 'auth.password_reset',
                'user.created', 'user.updated', 'user.deleted', 'user.role_changed',
                'project.created', 'project.updated', 'project.deleted',
                'team.created', 'team.updated', 'team.deleted',
                'team.member_added', 'team.member_removed',
                'settings.updated', 'sso.configured',
                'invitation.sent', 'invitation.accepted',
                'billing.subscribed', 'billing.plan_changed', 'billing.cancelled',
                'data.exported', 'data.account_deleted',
                'time_entry.approved', 'timesheet.submitted', 'timesheet.reviewed',
            ],
        ]);
    }
}
