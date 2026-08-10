<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreJobPostingRequest;
use App\Http\Requests\Hr\UpdateJobPostingRequest;
use App\Models\JobPosting;
use App\Services\JobPostingService;
use App\Services\PermissionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class JobPostingController extends Controller
{
    public function __construct(
        private readonly JobPostingService $service,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = JobPosting::where('organization_id', $request->user()->organization_id)
            ->with(['department:id,name', 'position:id,title']);

        if ($request->filled('department_id')) {
            $query->where('department_id', $request->input('department_id'));
        }

        if ($request->filled('employment_type')) {
            $query->where('employment_type', $request->input('employment_type'));
        }

        if ($request->has('is_published')) {
            $query->where('is_published', $request->boolean('is_published'));
        }

        if ($request->filled('search')) {
            $query->where('title', 'like', '%'.$request->input('search').'%');
        }

        $postings = $query->orderByDesc('created_at')->paginate(25);

        $postings->getCollection()->transform(
            fn (JobPosting $posting) => $this->withSalaryIfPermitted($posting, $request),
        );

        return response()->json($postings);
    }

    public function store(StoreJobPostingRequest $request): JsonResponse
    {
        $this->authorize('create', JobPosting::class);

        $posting = $this->service->create(
            $request->user()->organization,
            $request->validated(),
        );

        return response()->json([
            'data' => $this->withSalaryIfPermitted($posting->load(['department', 'position']), $request),
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $posting = $this->findForOrganization($request, $id);

        $this->authorize('view', $posting);

        return response()->json([
            'data' => $this->withSalaryIfPermitted($posting->load(['department', 'position']), $request),
        ]);
    }

    public function update(UpdateJobPostingRequest $request, string $id): JsonResponse
    {
        $posting = $this->findForOrganization($request, $id);

        $this->authorize('update', $posting);

        $posting = $this->service->update($posting, $request->validated());

        return response()->json([
            'data' => $this->withSalaryIfPermitted($posting, $request),
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $posting = $this->findForOrganization($request, $id);

        $this->authorize('delete', $posting);

        $this->service->delete($posting);

        return response()->json(['message' => 'Job posting deleted.']);
    }

    /**
     * Publish / unpublish. Separate from update so that job_postings.edit does
     * not implicitly grant the ability to put a posting in front of the public.
     */
    public function setPublished(Request $request, string $id): JsonResponse
    {
        $posting = $this->findForOrganization($request, $id);

        $this->authorize('publish', $posting);

        $validated = $request->validate([
            'is_published' => ['required', 'boolean'],
        ]);

        $posting = $this->service->setPublished($posting, $validated['is_published']);

        return response()->json([
            'data' => $this->withSalaryIfPermitted($posting, $request),
        ]);
    }

    private function findForOrganization(Request $request, string $id): JobPosting
    {
        return JobPosting::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);
    }

    /**
     * Salary is hidden by default on the model. Reveal it only for users who
     * hold job_postings.view_salary, and always attach the formatted string so
     * the admin list and the careers page render the range identically.
     */
    private function withSalaryIfPermitted(JobPosting $posting, Request $request): JobPosting
    {
        $canSee = app(PermissionService::class)
            ->hasPermission($request->user(), 'job_postings.view_salary');

        if ($canSee) {
            $posting->makeVisible(['min_salary', 'max_salary']);
            $posting->setAttribute('salary_display', $posting->salaryDisplay());
        }

        return $posting;
    }
}
