<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreLeaveTypeRequest;
use App\Models\LeaveType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveTypeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = LeaveType::where('organization_id', $request->user()->organization_id)
            ->orderBy('name');

        // Employees and managers only see active types (for apply-leave dropdown)
        if (! $request->user()->hasRole('owner', 'admin')) {
            $query->where('is_active', true);
        }

        $leaveTypes = $query->paginate(25);
        $leaveTypes->getCollection()->transform(fn ($lt) => $this->formatLeaveType($lt));

        return response()->json($leaveTypes);
    }

    public function store(StoreLeaveTypeRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $leaveType = LeaveType::create([
            'organization_id' => $request->user()->organization_id,
            'name'            => $validated['name'],
            'code'            => $validated['code'],
            'is_paid'         => $validated['type'] === 'paid',
            'days_per_year'   => $validated['days_per_year'],
            'accrual_type'    => $this->toAccrualType($validated['accrual_method'] ?? null),
            'carryover_days'  => $validated['max_carry_over'] ?? 0,
            'is_active'       => $validated['is_active'] ?? true,
        ]);

        return response()->json(['data' => $this->formatLeaveType($leaveType)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        if (! $request->user()->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $leaveType = LeaveType::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $validated = $request->validate([
            'name'           => 'sometimes|string|max:100',
            'type'           => 'sometimes|string|in:paid,unpaid',
            'days_per_year'  => 'sometimes|numeric|min:0|max:365',
            'accrual_method' => 'sometimes|string|in:annual,monthly,none',
            'max_carry_over' => 'sometimes|numeric|min:0',
            'is_active'      => 'sometimes|boolean',
        ]);

        $mapped = [];
        if (isset($validated['name']))           $mapped['name']          = $validated['name'];
        if (isset($validated['type']))           $mapped['is_paid']       = $validated['type'] === 'paid';
        if (isset($validated['days_per_year']))  $mapped['days_per_year'] = $validated['days_per_year'];
        if (isset($validated['accrual_method'])) $mapped['accrual_type']  = $this->toAccrualType($validated['accrual_method']);
        if (isset($validated['max_carry_over'])) $mapped['carryover_days'] = $validated['max_carry_over'];
        if (isset($validated['is_active']))      $mapped['is_active']     = $validated['is_active'];

        $leaveType->update($mapped);

        return response()->json(['data' => $this->formatLeaveType($leaveType)]);
    }

    private function formatLeaveType(LeaveType $lt): array
    {
        return [
            'id'             => $lt->id,
            'name'           => $lt->name,
            'code'           => $lt->code,
            'type'           => $lt->is_paid ? 'paid' : 'unpaid',
            'days_per_year'  => (float) $lt->days_per_year,
            'accrual_method' => $this->toAccrualMethod($lt->accrual_type),
            'max_carry_over' => (float) ($lt->carryover_days ?? 0),
            'is_active'      => (bool) $lt->is_active,
            'created_at'     => $lt->created_at,
            'updated_at'     => $lt->updated_at,
        ];
    }

    private function toAccrualMethod(?string $accrualType): string
    {
        return match ($accrualType) {
            'monthly'      => 'monthly',
            'upfront', 'anniversary' => 'annual',
            default        => 'none',
        };
    }

    private function toAccrualType(?string $accrualMethod): ?string
    {
        return match ($accrualMethod) {
            'monthly' => 'monthly',
            'annual'  => 'upfront',
            default   => null,
        };
    }
}
