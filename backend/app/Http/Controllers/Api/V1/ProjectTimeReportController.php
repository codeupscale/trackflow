<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PermissionService;
use App\Services\ProjectTimeReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Project-manager time report (filtered per-entry breakdown + CSV/PDF export).
 *
 * Gate: the route enforces permission:reports.view (index) and
 * permission:reports.export (export). The controller re-checks the permission as
 * an explicit authorize step; row-level role scoping lives in the service.
 */
class ProjectTimeReportController extends Controller
{
    public function __construct(
        private readonly ProjectTimeReportService $service,
        private readonly PermissionService $permissions,
    ) {}

    public function index(Request $request): JsonResponse
    {
        abort_unless(
            $this->permissions->hasPermission($request->user(), 'reports.view'),
            403,
            'You do not have permission to view reports.'
        );

        $filters = $this->validated($request);

        return response()->json($this->service->index($request->user(), $filters));
    }

    public function export(Request $request): Response
    {
        abort_unless(
            $this->permissions->hasPermission($request->user(), 'reports.export'),
            403,
            'You do not have permission to export reports.'
        );

        $request->validate(['format' => ['required', 'in:csv,pdf']]);
        $filters = $this->validated($request);

        return $request->input('format') === 'pdf'
            ? $this->service->pdf($request->user(), $filters)
            : $this->service->csv($request->user(), $filters);
    }

    /**
     * Shared filter validation for index + export.
     */
    private function validated(Request $request): array
    {
        $validated = $request->validate([
            'project_id' => ['nullable'],
            'project_id.*' => ['uuid'],
            'user_id' => ['nullable', 'uuid'],
            'period' => ['nullable', 'in:week,month,custom'],
            'week_of' => ['nullable', 'date_format:Y-m-d'],
            'month' => ['nullable', 'date_format:Y-m'],
            'start_date' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'group_by_day' => ['nullable', 'boolean'],
        ]);

        // A single-uuid project_id is allowed too; validate it when not an array.
        if (isset($validated['project_id']) && is_string($validated['project_id'])) {
            $request->validate(['project_id' => ['uuid']]);
        }

        return $validated;
    }
}
