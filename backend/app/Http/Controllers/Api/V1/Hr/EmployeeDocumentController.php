<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreEmployeeDocumentRequest;
use App\Models\EmployeeDocument;
use App\Models\User;
use App\Services\EmployeeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeDocumentController extends Controller
{
    public function __construct(
        private readonly EmployeeService $service,
    ) {}

    /**
     * List documents for an employee.
     */
    public function index(Request $request, string $employeeId): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        User::where('organization_id', $orgId)->findOrFail($employeeId);

        $this->authorize('viewAny', [EmployeeDocument::class, $employeeId]);

        $documents = $this->service->getDocuments(
            $employeeId,
            $orgId,
            $request->only(['category', 'per_page']),
        );

        return response()->json($documents);
    }

    /**
     * Upload a document for an employee.
     */
    public function store(StoreEmployeeDocumentRequest $request, string $employeeId): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        User::where('organization_id', $orgId)->findOrFail($employeeId);

        $this->authorize('create', [EmployeeDocument::class, $employeeId]);

        $document = $this->service->uploadDocument(
            $employeeId,
            $orgId,
            $request->file('file'),
            $request->validated(),
        );

        return response()->json(['data' => $document], 201);
    }

    /**
     * Soft delete a document (admin/owner only).
     */
    public function destroy(Request $request, string $employeeId, string $documentId): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $document = EmployeeDocument::where('organization_id', $orgId)
            ->where('user_id', $employeeId)
            ->findOrFail($documentId);

        $this->authorize('delete', $document);

        $this->service->deleteDocument($document);

        return response()->json(['message' => 'Document deleted.']);
    }

    /**
     * Mark a document as verified (admin/owner only).
     */
    public function verify(Request $request, string $employeeId, string $documentId): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $document = EmployeeDocument::where('organization_id', $orgId)
            ->where('user_id', $employeeId)
            ->findOrFail($documentId);

        $this->authorize('verify', $document);

        $verified = $this->service->verifyDocument($document, $request->user()->id);

        return response()->json(['data' => $verified]);
    }
}
