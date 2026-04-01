<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreDepartmentRequest;
use App\Http\Requests\Hr\UpdateDepartmentRequest;
use App\Models\Department;
use App\Services\OrganizationStructureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DepartmentController extends Controller
{
    public function __construct(
        private readonly OrganizationStructureService $service,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Department::where('organization_id', $request->user()->organization_id);

        if ($request->has('is_active')) {
            $query->where('is_active', filter_var($request->input('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        if ($request->filled('parent_department_id')) {
            $query->where('parent_department_id', $request->input('parent_department_id'));
        }

        $departments = $query->orderBy('name')->paginate(25);

        return response()->json($departments);
    }

    public function store(StoreDepartmentRequest $request): JsonResponse
    {
        $this->authorize('create', Department::class);

        $department = $this->service->createDepartment(
            $request->user()->organization,
            $request->validated(),
        );

        return response()->json(['data' => $department], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $department = Department::where('organization_id', $request->user()->organization_id)
            ->with('positions')
            ->findOrFail($id);

        $this->authorize('view', $department);

        return response()->json(['data' => $department]);
    }

    public function update(UpdateDepartmentRequest $request, string $id): JsonResponse
    {
        $department = Department::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('update', $department);

        $department = $this->service->updateDepartment($department, $request->validated());

        return response()->json(['data' => $department]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $department = Department::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('delete', $department);

        $this->service->archiveDepartment($department);

        return response()->json(['message' => 'Department archived.']);
    }

    public function tree(Request $request): JsonResponse
    {
        $tree = $this->service->getOrgTree($request->user()->organization);

        return response()->json(['tree' => $tree]);
    }
}
