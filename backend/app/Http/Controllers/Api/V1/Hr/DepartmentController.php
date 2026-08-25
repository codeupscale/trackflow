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

    /**
     * withCount() definition for a department's live headcount, exposed as
     * `employees_count` on the JSON payload.
     *
     * Deliberately counts only profiles whose user is still ACTIVE, matching
     * `EmployeeService::getDirectory()` (`users.is_active = true`). Without
     * that filter a department's count would include deactivated leavers and
     * disagree with the employee list the same user can open — the count has
     * to mean the same thing everywhere it is shown.
     *
     * The `head_count` COLUMN is dead (never written) and must not be used.
     */
    private function headcountAggregate(): array
    {
        return [
            'employeeProfiles as employees_count' => fn ($q) => $q->whereHas(
                'user',
                fn ($u) => $u->where('is_active', true)
            ),
        ];
    }

    public function index(Request $request): JsonResponse
    {
        // `manager` and `parent` are eager-loaded because the UI shows their NAMES.
        // Without this the payload carries only manager_id / parent_department_id and
        // every consumer silently renders a blank — which is exactly why the listing's
        // Parent column showed "--" for every row regardless of its real parent.
        $query = Department::where('organization_id', $request->user()->organization_id)
            ->with(['manager:id,name,email', 'parent:id,name,code'])
            ->withCount($this->headcountAggregate());

        if ($request->user()->isEmployee()) {
            $deptId = $request->user()->employeeProfile?->department_id;
            if ($deptId) {
                $query->where('id', $deptId);
            } else {
                $query->whereRaw('1 = 0');
            }
        }

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
            ->with(['positions', 'manager:id,name,email', 'parent:id,name,code'])
            ->withCount($this->headcountAggregate())
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
        if ($request->user()->isEmployee()) {
            $deptId = $request->user()->employeeProfile?->department_id;
            if ($deptId) {
                $dept = Department::where('organization_id', $request->user()->organization_id)
                    ->with('positions')
                    ->withCount($this->headcountAggregate())
                    ->find($deptId);
                $tree = $dept ? [$dept->toArray()] : [];
            } else {
                $tree = [];
            }

            return response()->json(['tree' => $tree]);
        }

        $tree = $this->service->getOrgTree($request->user()->organization);

        return response()->json(['tree' => $tree]);
    }
}
