<?php

namespace Tests\Feature\Hr;

use App\Models\Asset;
use App\Models\Organization;
use App\Models\User;
use App\Notifications\AssetAssigned;
use App\Notifications\AssetReturned;
use App\Notifications\OrgActivity;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Asset register and hand-overs.
 *
 * The properties that matter most: an item is with one person at a time, every
 * hand-over stays on record, only HR can move items, and an employee sees only
 * what they hold.
 */
class AssetTest extends TestCase
{
    private Organization $org;

    private User $owner;

    private User $hr;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();

        Notification::fake();

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->hr = $this->createUser($this->org, 'hr_manager');
        $this->alice = $this->createUser($this->org, 'employee');
        $this->bob = $this->createUser($this->org, 'employee');
    }

    private function createAsset(array $overrides = []): array
    {
        return $this->actingAs($this->hr, 'sanctum')
            ->postJson('/api/v1/hr/assets', array_merge([
                'name' => 'MacBook Pro 14',
                'category' => 'laptop',
                'brand' => 'Apple',
                'serial_number' => 'SN-' . uniqid(),
                'purchase_cost' => 350000,
            ], $overrides))
            ->assertStatus(201)
            ->json('data');
    }

    // ── Register ───────────────────────────────────────────────────────

    public function test_hr_can_add_an_item_and_tags_are_sequential(): void
    {
        $first = $this->createAsset();
        $second = $this->createAsset();

        $this->assertSame('AST-0001', $first['asset_tag']);
        $this->assertSame('AST-0002', $second['asset_tag']);
        $this->assertSame('available', $first['status']);
    }

    public function test_a_deleted_items_tag_is_never_reused(): void
    {
        // A sticker already printed must keep meaning one item.
        $first = $this->createAsset();
        $this->deleteJson("/api/v1/hr/assets/{$first['id']}")->assertOk();

        $this->assertSame('AST-0002', $this->createAsset()['asset_tag']);
    }

    public function test_an_employee_cannot_add_items(): void
    {
        $this->actingAs($this->alice, 'sanctum')
            ->postJson('/api/v1/hr/assets', ['name' => 'Laptop', 'category' => 'laptop'])
            ->assertStatus(403);
    }

    public function test_serial_numbers_are_unique_within_an_org_but_not_across_orgs(): void
    {
        $this->createAsset(['serial_number' => 'C02XYZ']);

        $this->postJson('/api/v1/hr/assets', ['name' => 'Dup', 'category' => 'laptop', 'serial_number' => 'C02XYZ'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('serial_number');

        $otherOrg = $this->createOrganization();
        $otherHr = $this->createUser($otherOrg, 'hr_manager');
        $this->actingAs($otherHr, 'sanctum')
            ->postJson('/api/v1/hr/assets', ['name' => 'Same serial', 'category' => 'laptop', 'serial_number' => 'C02XYZ'])
            ->assertStatus(201);
    }

    public function test_status_cannot_be_set_to_assigned_by_editing(): void
    {
        $asset = $this->createAsset();

        $this->putJson("/api/v1/hr/assets/{$asset['id']}", ['status' => 'assigned'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('status');
    }

    // ── Hand-overs ─────────────────────────────────────────────────────

    public function test_assigning_hands_the_item_to_one_person_and_records_it(): void
    {
        $asset = $this->createAsset();

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id, 'notes' => 'With charger'])
            ->assertOk()
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.current_holder_id', $this->alice->id);

        $this->assertDatabaseHas('asset_assignments', [
            'asset_id' => $asset['id'],
            'user_id' => $this->alice->id,
            'assigned_by' => $this->hr->id,
            'returned_at' => null,
        ]);
    }

    public function test_an_assigned_item_cannot_be_assigned_again(): void
    {
        $asset = $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id])->assertOk();

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->bob->id])
            ->assertStatus(422);

        $this->assertSame($this->alice->id, Asset::find($asset['id'])->current_holder_id);
    }

    public function test_an_item_cannot_be_assigned_to_someone_in_another_org(): void
    {
        $asset = $this->createAsset();
        $outsider = $this->createUser($this->createOrganization(), 'employee');

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $outsider->id])
            ->assertStatus(422);
    }

    public function test_returning_closes_the_hand_over_and_frees_the_item(): void
    {
        $asset = $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id])->assertOk();

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/return", ['condition' => 'fair'])
            ->assertOk()
            ->assertJsonPath('data.status', 'available')
            ->assertJsonPath('data.condition', 'fair')
            ->assertJsonPath('data.current_holder_id', null);

        $this->assertDatabaseHas('asset_assignments', [
            'asset_id' => $asset['id'],
            'user_id' => $this->alice->id,
            'received_by' => $this->hr->id,
            'condition_on_return' => 'fair',
        ]);
    }

    public function test_a_return_can_send_the_item_to_repair_or_record_it_lost(): void
    {
        $repair = $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$repair['id']}/assign", ['user_id' => $this->alice->id]);
        $this->postJson("/api/v1/hr/assets/{$repair['id']}/return", ['condition' => 'damaged', 'status_after' => 'in_repair'])
            ->assertJsonPath('data.status', 'in_repair');

        $lost = $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$lost['id']}/assign", ['user_id' => $this->bob->id]);
        $this->postJson("/api/v1/hr/assets/{$lost['id']}/return", ['condition' => 'poor', 'status_after' => 'lost'])
            ->assertJsonPath('data.status', 'lost');
    }

    public function test_an_item_in_repair_cannot_be_assigned(): void
    {
        $asset = $this->createAsset(['status' => 'in_repair']);

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id])
            ->assertStatus(422);
    }

    public function test_history_is_kept_across_every_hand_over(): void
    {
        $asset = $this->createAsset();

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id]);
        $this->postJson("/api/v1/hr/assets/{$asset['id']}/return", ['condition' => 'good']);
        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->bob->id]);

        $history = $this->getJson("/api/v1/hr/assets/{$asset['id']}")->assertOk()->json('history');

        $this->assertCount(2, $history);
        $this->assertEqualsCanonicalizing([$this->alice->id, $this->bob->id], array_column($history, 'user_id'));
    }

    public function test_an_assigned_item_cannot_be_deleted_or_have_its_status_edited(): void
    {
        $asset = $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id]);

        $this->deleteJson("/api/v1/hr/assets/{$asset['id']}")->assertStatus(422);
        $this->putJson("/api/v1/hr/assets/{$asset['id']}", ['status' => 'retired'])->assertStatus(422);
    }

    // ── Visibility ─────────────────────────────────────────────────────

    public function test_an_employee_sees_only_the_items_they_hold(): void
    {
        $mine = $this->createAsset(['name' => 'Alice laptop']);
        $theirs = $this->createAsset(['name' => 'Bob laptop']);
        $this->createAsset(['name' => 'In stock']);
        $this->postJson("/api/v1/hr/assets/{$mine['id']}/assign", ['user_id' => $this->alice->id]);
        $this->postJson("/api/v1/hr/assets/{$theirs['id']}/assign", ['user_id' => $this->bob->id]);

        $this->actingAs($this->alice, 'sanctum');

        $response = $this->getJson('/api/v1/hr/assets')->assertOk()
            ->assertJsonPath('meta.scope', 'own')
            ->assertJsonPath('meta.can_manage', false);
        $this->assertSame(['Alice laptop'], array_column($response->json('data'), 'name'));

        $this->getJson("/api/v1/hr/assets/{$theirs['id']}")->assertStatus(404);
        $this->getJson('/api/v1/hr/assets/summary')->assertStatus(403);
    }

    public function test_filtering_by_holder_shows_hr_that_persons_items(): void
    {
        // The employee profile Assets tab asks for one person's items.
        $mine = $this->createAsset(['name' => 'Alice laptop']);
        $this->createAsset(['name' => 'Not hers']);
        $this->postJson("/api/v1/hr/assets/{$mine['id']}/assign", ['user_id' => $this->alice->id]);

        $rows = $this->getJson("/api/v1/hr/assets?holder_id={$this->alice->id}")->assertOk()->json('data');

        $this->assertSame(['Alice laptop'], array_column($rows, 'name'));
    }

    public function test_an_employee_cannot_see_another_persons_items_by_filtering_on_them(): void
    {
        // The profile tab is hidden for this case, but the API must not rely on
        // that: asking for a colleague's items narrows to nothing rather than
        // widening an own-scope view.
        $bobs = $this->createAsset(['name' => 'Bob laptop']);
        $this->postJson("/api/v1/hr/assets/{$bobs['id']}/assign", ['user_id' => $this->bob->id]);

        $this->actingAs($this->alice, 'sanctum')
            ->getJson("/api/v1/hr/assets?holder_id={$this->bob->id}")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_hr_and_owner_see_the_whole_register(): void
    {
        $this->createAsset();
        $this->createAsset();

        foreach ([$this->hr, $this->owner] as $user) {
            $this->actingAs($user, 'sanctum')
                ->getJson('/api/v1/hr/assets')
                ->assertOk()
                ->assertJsonPath('meta.scope', 'organization')
                ->assertJsonPath('meta.total', 2);
        }
    }

    public function test_an_item_from_another_org_is_not_found(): void
    {
        $asset = $this->createAsset();
        $otherHr = $this->createUser($this->createOrganization(), 'hr_manager');

        $this->actingAs($otherHr, 'sanctum')
            ->getJson("/api/v1/hr/assets/{$asset['id']}")
            ->assertStatus(404);
    }

    public function test_summary_counts_by_status(): void
    {
        $a = $this->createAsset();
        $this->createAsset();
        $this->postJson("/api/v1/hr/assets/{$a['id']}/assign", ['user_id' => $this->alice->id]);

        $this->getJson('/api/v1/hr/assets/summary')
            ->assertOk()
            ->assertJsonPath('data.total', 2)
            ->assertJsonPath('data.by_status.assigned', 1)
            ->assertJsonPath('data.by_status.available', 1);
    }

    // ── Notifications ──────────────────────────────────────────────────

    public function test_hand_overs_notify_the_employee_and_the_owner_but_not_the_hr_actor(): void
    {
        $asset = $this->createAsset();

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/assign", ['user_id' => $this->alice->id]);
        Notification::assertSentTo($this->alice, AssetAssigned::class);
        Notification::assertSentTo($this->owner, OrgActivity::class, fn ($n) => $n->category() === 'asset.assigned');
        Notification::assertNotSentTo($this->hr, OrgActivity::class, fn ($n) => $n->category() === 'asset.assigned');

        $this->postJson("/api/v1/hr/assets/{$asset['id']}/return", ['condition' => 'good']);
        Notification::assertSentTo($this->alice, AssetReturned::class);
        Notification::assertSentTo($this->owner, OrgActivity::class, fn ($n) => $n->category() === 'asset.returned');
    }
}
