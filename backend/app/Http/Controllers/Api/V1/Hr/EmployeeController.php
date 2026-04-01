<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\UpdateEmployeeProfileRequest;
use App\Models\EmployeeProfile;
use App\Models\User;
use App\Services\EmployeeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeController extends Controller
{
    public function __construct(
        private readonly EmployeeService $service,
    ) {}

    /**
     * Paginated employee directory with search and filters.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', EmployeeProfile::class);

        $employees = $this->service->getDirectory(
            $request->user()->organization_id,
            $request->only(['search', 'department_id', 'position_id', 'employment_status', 'employment_type', 'per_page']),
        );

        // Transform flat join result to nested format expected by frontend
        $employees->getCollection()->transform(function ($emp) {
            $emp->department = $emp->department_id ? [
                'id' => $emp->department_id,
                'name' => $emp->department_name,
            ] : null;
            $emp->position = $emp->position_id ? [
                'id' => $emp->position_id,
                'title' => $emp->position_title,
            ] : null;
            unset($emp->department_id, $emp->department_name, $emp->position_id, $emp->position_title);
            return $emp;
        });

        return response()->json($employees);
    }

    /**
     * Show full employee profile. Financial fields masked for non-admin.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        // Verify the employee belongs to the same org
        $employee = User::where('organization_id', $orgId)->findOrFail($id);

        $profile = $this->service->getOrCreateProfile($employee->id, $orgId);
        $profile->load(['department', 'position', 'reportingManager', 'user']);

        $this->authorize('view', $profile);

        $data = $profile->toArray();

        // Expose financial fields: masked for non-admin, full for admin/owner
        $canViewFinancial = $request->user()->hasRole('owner', 'admin');
        $data['bank_name'] = $canViewFinancial
            ? $profile->bank_name
            : $this->service->maskFinancialField($profile->bank_name);
        $data['bank_account_number'] = $canViewFinancial
            ? $profile->bank_account_number
            : $this->service->maskFinancialField($profile->bank_account_number);
        $data['bank_routing_number'] = $canViewFinancial
            ? $profile->bank_routing_number
            : $this->service->maskFinancialField($profile->bank_routing_number);
        $data['tax_id'] = $canViewFinancial
            ? $profile->tax_id
            : $this->service->maskFinancialField($profile->tax_id);

        return response()->json(['data' => $data]);
    }

    /**
     * Update employee profile.
     */
    public function updateProfile(UpdateEmployeeProfileRequest $request, string $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        // Verify the employee belongs to the same org
        $employee = User::where('organization_id', $orgId)->findOrFail($id);

        $profile = $this->service->getOrCreateProfile($employee->id, $orgId);

        $this->authorize('update', $profile);

        $updated = $this->service->updateProfile(
            $employee->id,
            $orgId,
            $request->validated(),
            $request->user(),
        );

        $data = $updated->toArray();

        // Expose financial fields in response
        $canViewFinancial = $request->user()->hasRole('owner', 'admin');
        $data['bank_name'] = $canViewFinancial
            ? $updated->bank_name
            : $this->service->maskFinancialField($updated->bank_name);
        $data['bank_account_number'] = $canViewFinancial
            ? $updated->bank_account_number
            : $this->service->maskFinancialField($updated->bank_account_number);
        $data['bank_routing_number'] = $canViewFinancial
            ? $updated->bank_routing_number
            : $this->service->maskFinancialField($updated->bank_routing_number);
        $data['tax_id'] = $canViewFinancial
            ? $updated->tax_id
            : $this->service->maskFinancialField($updated->tax_id);

        return response()->json(['data' => $data]);
    }
}
