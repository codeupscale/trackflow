<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreEmployeeNoteRequest;
use App\Models\EmployeeNote;
use App\Models\User;
use App\Services\EmployeeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeNoteController extends Controller
{
    public function __construct(
        private readonly EmployeeService $service,
    ) {}

    /**
     * List notes for an employee (admin/owner only).
     */
    public function index(Request $request, string $employeeId): JsonResponse
    {
        $this->authorize('viewAny', EmployeeNote::class);

        $orgId = $request->user()->organization_id;

        // Verify employee belongs to same org
        User::where('organization_id', $orgId)->findOrFail($employeeId);

        $notes = $this->service->getNotes($employeeId, $orgId, $request->user());

        return response()->json($notes);
    }

    /**
     * Create a note for an employee (admin/owner only).
     */
    public function store(StoreEmployeeNoteRequest $request, string $employeeId): JsonResponse
    {
        $this->authorize('create', EmployeeNote::class);

        $orgId = $request->user()->organization_id;

        // Verify employee belongs to same org
        User::where('organization_id', $orgId)->findOrFail($employeeId);

        $note = $this->service->createNote(
            $employeeId,
            $orgId,
            $request->user()->id,
            $request->validated(),
        );

        return response()->json(['data' => $note->load('author:id,name,email,avatar_url')], 201);
    }

    /**
     * Delete a note (admin/owner only).
     */
    public function destroy(Request $request, string $employeeId, string $noteId): JsonResponse
    {
        $note = EmployeeNote::where('organization_id', $request->user()->organization_id)
            ->where('user_id', $employeeId)
            ->findOrFail($noteId);

        $this->authorize('delete', $note);

        $note->delete();

        return response()->json(null, 204);
    }
}
