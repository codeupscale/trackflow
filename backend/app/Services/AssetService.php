<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\Organization;
use App\Models\User;
use App\Notifications\AssetAssigned;
use App\Notifications\AssetReturned;
use App\Notifications\OrgActivity;
use App\Support\AnnouncesOrgActivity;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Company property and who holds it.
 *
 * Every state change that moves an item between people goes through assign()
 * and returnAsset() — update() deliberately cannot set a holder or mark an item
 * assigned. That single door is what keeps the history in asset_assignments
 * complete: an item that could be "assigned" by editing a field would have a
 * holder with no hand-over on record.
 */
class AssetService
{
    use AnnouncesOrgActivity;

    public function __construct(
        private readonly PermissionService $permissions,
    ) {}

    // ── Access ────────────────────────────────────────────────────────

    public function canManage(User $actor): bool
    {
        return $this->permissions->hasPermission($actor, 'assets.manage');
    }

    /**
     * Whether the actor sees the whole register or only what they hold.
     *
     * Decided from the permission SCOPE, never from a request parameter, so a
     * caller cannot widen their own view by asking for it.
     */
    public function seesOrganization(User $actor): bool
    {
        return $this->canManage($actor)
            || $this->permissions->hasPermission($actor, 'assets.view', 'organization');
    }

    // ── Reading ───────────────────────────────────────────────────────

    public function list(User $actor, array $filters): LengthAwarePaginator
    {
        // The open hand-over rides along so a holder's own view can say when an
        // item was given to them and by whom, and when it is due back, without
        // a request per item.
        $query = Asset::query()->with([
            'holder:id,name,email,avatar_url',
            'openAssignment:id,asset_id,user_id,assigned_by,assigned_at,expected_return_on,condition_on_assign',
            'openAssignment.assigner:id,name',
        ]);

        if (! $this->seesOrganization($actor)) {
            $query->where('current_holder_id', $actor->id);
        }

        if (! empty($filters['search'])) {
            $term = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filters['search']) . '%';
            $query->where(function ($q) use ($term) {
                $q->where('asset_tag', 'ilike', $term)
                    ->orWhere('name', 'ilike', $term)
                    ->orWhere('serial_number', 'ilike', $term)
                    ->orWhere('brand', 'ilike', $term)
                    ->orWhere('model', 'ilike', $term);
            });
        }

        foreach (['status', 'category'] as $field) {
            if (! empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }

        if (! empty($filters['holder_id'])) {
            $query->where('current_holder_id', $filters['holder_id']);
        }

        return $query->orderBy('asset_tag')
            ->paginate(min((int) ($filters['per_page'] ?? 25), 100));
    }

    /**
     * The numbers across the top of the register.
     *
     * Counted over the whole organization, not the current page, and in one
     * grouped query rather than one per status.
     */
    public function summary(string $organizationId): array
    {
        $counts = Asset::query()
            ->where('organization_id', $organizationId)
            ->selectRaw('status, COUNT(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $byStatus = [];
        foreach (Asset::STATUSES as $status) {
            $byStatus[$status] = (int) ($counts[$status] ?? 0);
        }

        return [
            'total' => array_sum($byStatus),
            'by_status' => $byStatus,
            'total_value' => (float) Asset::query()->where('organization_id', $organizationId)->sum('purchase_cost'),
            // Within 30 days, and not already past — an expired warranty is a
            // fact about the item, an expiring one is something to act on.
            'warranty_expiring_soon' => Asset::query()
                ->where('organization_id', $organizationId)
                ->whereNotIn('status', ['retired', 'lost'])
                ->whereBetween('warranty_expires_on', [now()->toDateString(), now()->addDays(30)->toDateString()])
                ->count(),
        ];
    }

    public function history(Asset $asset): \Illuminate\Support\Collection
    {
        return $asset->assignments()
            ->with(['user:id,name,email', 'assigner:id,name', 'receiver:id,name'])
            ->get();
    }

    // ── Writing ───────────────────────────────────────────────────────

    public function create(User $actor, array $data): Asset
    {
        return DB::transaction(function () use ($actor, $data) {
            // Serialise tag allocation per organization. Two items added at the
            // same moment would otherwise both read AST-0041 as the latest and
            // collide on the unique index.
            Organization::withoutGlobalScopes()->whereKey($actor->organization_id)->lockForUpdate()->first();

            return Asset::create([
                ...$this->onlyEditable($data),
                'organization_id' => $actor->organization_id,
                'asset_tag' => $data['asset_tag'] ?? $this->nextTag($actor->organization_id),
                'status' => $data['status'] ?? 'available',
                'condition' => $data['condition'] ?? 'good',
                'created_by' => $actor->id,
            ])->load('holder:id,name,email,avatar_url');
        });
    }

    public function update(Asset $asset, array $data): Asset
    {
        // Status changes that move an item between people belong to
        // assign/return. Editing an assigned item's status directly would leave
        // an open hand-over with nobody's name on the item.
        if (array_key_exists('status', $data) && $data['status'] !== $asset->status) {
            if ($asset->status === 'assigned') {
                abort(422, 'This item is assigned to someone. Record its return before changing its status.');
            }
            if ($data['status'] === 'assigned') {
                abort(422, 'Use Assign to give an item to someone.');
            }
        }

        $asset->update($this->onlyEditable($data) + (isset($data['status']) ? ['status' => $data['status']] : []));

        return $asset->fresh()->load('holder:id,name,email,avatar_url');
    }

    public function delete(Asset $asset): void
    {
        if ($asset->status === 'assigned') {
            abort(422, 'This item is still assigned. Record its return before deleting it.');
        }

        // Soft delete: the hand-over history still references it.
        $asset->delete();
    }

    /**
     * Hand an item to someone.
     */
    public function assign(User $actor, Asset $asset, string $userId, ?string $expectedReturnOn = null, ?string $notes = null): Asset
    {
        $recipient = User::withoutGlobalScopes()
            ->where('organization_id', $actor->organization_id)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->find($userId);

        if (! $recipient) {
            // Resolved inside the actor's org: a user id from another tenant is
            // indistinguishable from one that does not exist.
            abort(422, 'That person is not an active member of this organization.');
        }

        try {
            $assigned = DB::transaction(function () use ($actor, $asset, $recipient, $expectedReturnOn, $notes) {
                $locked = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();

                if ($locked->status !== 'available') {
                    abort(422, match ($locked->status) {
                        'assigned' => 'This item is already assigned. Record its return first.',
                        'in_repair' => 'This item is in repair and cannot be assigned yet.',
                        default => 'Only available items can be assigned.',
                    });
                }

                AssetAssignment::create([
                    'organization_id' => $locked->organization_id,
                    'asset_id' => $locked->id,
                    'user_id' => $recipient->id,
                    'assigned_by' => $actor->id,
                    'assigned_at' => now(),
                    'condition_on_assign' => $locked->condition,
                    'expected_return_on' => $expectedReturnOn,
                    'notes' => $notes,
                ]);

                $locked->update(['status' => 'assigned', 'current_holder_id' => $recipient->id]);

                return $locked->fresh()->load('holder:id,name,email,avatar_url');
            });
        } catch (QueryException $e) {
            // The partial unique index on open assignments is the last line of
            // defence against a race the row lock should already prevent.
            if (str_contains($e->getMessage(), 'uq_asset_assignments_one_open')) {
                abort(422, 'This item was just assigned to someone else.');
            }
            throw $e;
        }

        // After the commit, and never able to undo the hand-over.
        $this->announceAssignment($actor, $assigned, $recipient, $expectedReturnOn);

        return $assigned;
    }

    /**
     * Record an item coming back.
     *
     * @param  string  $statusAfter  available | in_repair | lost
     */
    public function returnAsset(User $actor, Asset $asset, string $condition, string $statusAfter = 'available', ?string $notes = null): Asset
    {
        $formerHolder = null;

        $returned = DB::transaction(function () use ($actor, $asset, $condition, $statusAfter, $notes, &$formerHolder) {
            $locked = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'assigned') {
                abort(422, 'This item is not currently assigned to anyone.');
            }

            $open = AssetAssignment::where('asset_id', $locked->id)->whereNull('returned_at')->first();

            if ($open) {
                $open->update([
                    'returned_at' => now(),
                    'received_by' => $actor->id,
                    'condition_on_return' => $condition,
                    // Appended, not replaced: the notes written at hand-over are
                    // part of the record too.
                    'notes' => trim(implode("\n", array_filter([$open->notes, $notes]))) ?: null,
                ]);
                $formerHolder = User::withoutGlobalScopes()->find($open->user_id);
            }

            $locked->update([
                'status' => $statusAfter,
                'condition' => $condition,
                'current_holder_id' => null,
            ]);

            return $locked->fresh()->load('holder:id,name,email,avatar_url');
        });

        if ($formerHolder) {
            $this->announceReturn($actor, $returned, $formerHolder, $condition, $statusAfter);
        }

        return $returned;
    }

    // ── Internals ─────────────────────────────────────────────────────

    /** Fields a caller may set directly. Holder and assigned status are not among them. */
    private function onlyEditable(array $data): array
    {
        return array_intersect_key($data, array_flip([
            'name', 'category', 'brand', 'model', 'serial_number',
            'purchase_date', 'purchase_cost', 'warranty_expires_on', 'condition', 'notes',
        ]));
    }

    /**
     * The next tag in the organization's sequence: AST-0001, AST-0002…
     *
     * Read from the highest NUMBER rather than the newest row, so a deleted
     * item never frees its tag for reuse — a sticker already printed must keep
     * meaning one item.
     */
    private function nextTag(string $organizationId): string
    {
        $highest = Asset::withTrashed()
            ->where('organization_id', $organizationId)
            ->where('asset_tag', 'like', 'AST-%')
            ->pluck('asset_tag')
            ->map(fn ($tag) => (int) substr($tag, 4))
            ->max() ?? 0;

        return sprintf('AST-%04d', $highest + 1);
    }

    private function announceAssignment(User $actor, Asset $asset, User $recipient, ?string $expectedReturnOn): void
    {
        try {
            if ($recipient->id !== $actor->id) {
                $recipient->notify(new AssetAssigned($asset, $actor->name, $expectedReturnOn));
            }
        } catch (\Throwable $e) {
            report($e);
        }

        $this->announceToOrg($asset->organization_id, $actor->id, OrgActivity::assetAssigned(
            assetName: $asset->name,
            assetTag: $asset->asset_tag,
            holderName: $recipient->name,
            by: $actor->name,
        ));
    }

    private function announceReturn(User $actor, Asset $asset, User $formerHolder, string $condition, string $statusAfter): void
    {
        try {
            if ($formerHolder->id !== $actor->id) {
                $formerHolder->notify(new AssetReturned($asset, $actor->name, $condition));
            }
        } catch (\Throwable $e) {
            report($e);
        }

        $this->announceToOrg($asset->organization_id, $actor->id, OrgActivity::assetReturned(
            assetName: $asset->name,
            assetTag: $asset->asset_tag,
            fromName: $formerHolder->name,
            condition: $condition,
            statusAfter: $statusAfter,
        ));
    }
}
