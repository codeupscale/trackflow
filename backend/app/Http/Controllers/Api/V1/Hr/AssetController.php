<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreAssetRequest;
use App\Models\Asset;
use App\Services\AssetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Company property and hand-overs. Thin: rules live in AssetService.
 *
 * Route model binding resolves {asset} through the model's organization scope,
 * so an id from another tenant is a 404 before any method here runs.
 */
class AssetController extends Controller
{
    public function __construct(
        private readonly AssetService $assets,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $page = $this->assets->list($request->user(), $request->only(['search', 'status', 'category', 'holder_id', 'per_page']));

        return response()->json([
            'data' => $page->items(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'total' => $page->total(),
                // Tells the screen whether to render the register or "my items",
                // so the client never re-derives the rule the server applied.
                'scope' => $this->assets->seesOrganization($request->user()) ? 'organization' : 'own',
                'can_manage' => $this->assets->canManage($request->user()),
            ],
        ]);
    }

    public function summary(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->assets->summary($request->user()->organization_id)]);
    }

    public function show(Request $request, Asset $asset): JsonResponse
    {
        // Someone without the org-wide view may open only an item they hold.
        abort_unless(
            $this->assets->seesOrganization($request->user()) || $asset->current_holder_id === $request->user()->id,
            404,
        );

        return response()->json([
            'data' => $asset->load('holder:id,name,email,avatar_url', 'creator:id,name'),
            'history' => $this->assets->history($asset),
        ]);
    }

    public function store(StoreAssetRequest $request): JsonResponse
    {
        $asset = $this->assets->create($request->user(), $request->validated());

        return response()->json(['data' => $asset], 201);
    }

    public function update(StoreAssetRequest $request, Asset $asset): JsonResponse
    {
        return response()->json(['data' => $this->assets->update($asset, $request->validated())]);
    }

    public function destroy(Asset $asset): JsonResponse
    {
        $this->assets->delete($asset);

        return response()->json(['message' => 'Asset deleted.']);
    }

    public function assign(Request $request, Asset $asset): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => ['required', 'uuid'],
            'expected_return_on' => ['nullable', 'date', 'after_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $assigned = $this->assets->assign(
            $request->user(),
            $asset,
            $validated['user_id'],
            $validated['expected_return_on'] ?? null,
            $validated['notes'] ?? null,
        );

        return response()->json(['data' => $assigned]);
    }

    public function returnAsset(Request $request, Asset $asset): JsonResponse
    {
        $validated = $request->validate([
            'condition' => ['required', Rule::in(Asset::CONDITIONS)],
            'status_after' => ['sometimes', Rule::in(['available', 'in_repair', 'lost'])],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $returned = $this->assets->returnAsset(
            $request->user(),
            $asset,
            $validated['condition'],
            $validated['status_after'] ?? 'available',
            $validated['notes'] ?? null,
        );

        return response()->json(['data' => $returned]);
    }
}
