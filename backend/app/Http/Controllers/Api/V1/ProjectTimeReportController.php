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
            'user_id' => ['nullable'],
            'user_id.*' => ['uuid'],
            'period' => ['nullable', 'in:week,month,custom'],
            'week_of' => ['nullable', 'date_format:Y-m-d'],
            'month' => ['nullable', 'date_format:Y-m'],
            'start_date' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'group_by_day' => ['nullable', 'boolean'],
        ]);

        // project_id / user_id accept a single uuid as well as an array of them.
        // The `.*` rules above only cover the array form, so validate the scalar
        // form here — `uuid` on the top-level key would reject a valid array.
        $scalarRules = [];
        foreach (['project_id', 'user_id'] as $key) {
            if (isset($validated[$key]) && is_string($validated[$key])) {
                $scalarRules[$key] = ['uuid'];
            }
        }

        if ($scalarRules) {
            $request->validate($scalarRules);
        }

        return $validated;
    }
}
