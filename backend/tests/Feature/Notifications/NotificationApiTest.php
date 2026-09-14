<?php

namespace Tests\Feature\Notifications;

use App\Models\DatabaseNotification;
use App\Models\User;
use App\Services\PermissionService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The bell's HTTP surface: who can read, mark and delete what.
 *
 * The security property under test is structural rather than a permission
 * check — every route reads through the caller's own relation — so these tests
 * aim at the ways that could be broken: an id that belongs to someone else, an
 * id that is not a uuid at all, and a role without the feature.
 */
class NotificationApiTest extends TestCase
{
    private function notify(User $user, array $overrides = []): DatabaseNotification
    {
        return DatabaseNotification::create(array_merge([
            'id' => (string) Str::uuid(),
            'type' => 'holiday.announced',
            'notifiable_type' => User::class,
            'notifiable_id' => $user->id,
            'organization_id' => $user->organization_id,
            'data' => ['category' => 'holiday.announced', 'title' => 'Holiday', 'body' => 'Closed.', 'url' => '/hr/leave/calendar', 'meta' => []],
            'read_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_requires_authentication(): void
    {
        $this->getJson('/api/v1/notifications')->assertStatus(401);
    }

    public function test_lists_only_the_callers_own_notifications(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        $bob = $this->createUser($org, 'employee');

        $this->notify($alice, ['data' => ['category' => 'holiday.announced', 'title' => 'For Alice', 'body' => '', 'url' => null, 'meta' => []]]);
        $this->notify($bob, ['data' => ['category' => 'holiday.announced', 'title' => 'For Bob', 'body' => '', 'url' => null, 'meta' => []]]);

        $this->actingAs($alice, 'sanctum')
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'For Alice')
            ->assertJsonPath('meta.total', 1);
    }

    public function test_payload_is_flattened_and_never_exposes_the_raw_data_column(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        $this->notify($alice);

        $row = $this->actingAs($alice, 'sanctum')->getJson('/api/v1/notifications')->json('data.0');

        foreach (['id', 'category', 'title', 'body', 'url', 'meta', 'read_at', 'created_at'] as $key) {
            $this->assertArrayHasKey($key, $row);
        }
        $this->assertArrayNotHasKey('data', $row);
    }

    public function test_cannot_mark_or_delete_someone_elses_notification(): void
    {
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $alice = $this->createUser($org, 'employee');
        $theirs = $this->notify($owner);

        $this->actingAs($alice, 'sanctum');
        $this->postJson("/api/v1/notifications/{$theirs->id}/read")->assertStatus(404);
        $this->deleteJson("/api/v1/notifications/{$theirs->id}")->assertStatus(404);

        $this->assertDatabaseHas('notifications', ['id' => $theirs->id, 'read_at' => null]);
    }

    public function test_a_malformed_id_is_a_404_not_a_server_error(): void
    {
        // Postgres rejects a non-uuid literal outright, which used to surface
        // as a 500 before the controller checked the id's shape.
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');

        $this->actingAs($alice, 'sanctum');
        $this->postJson('/api/v1/notifications/not-a-uuid/read')->assertStatus(404);
        $this->deleteJson('/api/v1/notifications/not-a-uuid')->assertStatus(404);
    }

    public function test_marking_read_is_idempotent_and_does_not_move_the_timestamp(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        $n = $this->notify($alice);

        $this->actingAs($alice, 'sanctum');
        $first = $this->postJson("/api/v1/notifications/{$n->id}/read")->assertOk()->json('data.read_at');
        $this->travel(5)->minutes();
        $second = $this->postJson("/api/v1/notifications/{$n->id}/read")->assertOk()->json('data.read_at');

        $this->assertNotNull($first);
        $this->assertSame($first, $second);
    }

    public function test_mark_all_read_clears_the_unread_count(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        $this->notify($alice);
        $this->notify($alice);

        $this->actingAs($alice, 'sanctum');
        $this->getJson('/api/v1/notifications')->assertJsonPath('meta.unread_count', 2);
        $this->postJson('/api/v1/notifications/read-all')->assertOk()->assertJsonPath('data.marked', 2);
        $this->getJson('/api/v1/notifications')->assertJsonPath('meta.unread_count', 0);
    }

    public function test_unread_filter_returns_only_unread(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        $this->notify($alice);
        $this->notify($alice, ['read_at' => now()]);

        $rows = $this->actingAs($alice, 'sanctum')
            ->getJson('/api/v1/notifications?unread=1')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]['read_at']);
    }

    public function test_page_size_is_capped_at_fifty(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');

        for ($i = 0; $i < 55; $i++) {
            $this->notify($alice, ['created_at' => now()->subMinutes($i)]);
        }

        $this->actingAs($alice, 'sanctum')
            ->getJson('/api/v1/notifications?per_page=999')
            ->assertOk()
            ->assertJsonCount(50, 'data')
            ->assertJsonPath('meta.total', 55);
    }

    public function test_a_role_without_the_feature_is_forbidden(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');

        $roleId = DB::table('user_roles')->where('user_id', $alice->id)->value('role_id');
        $permissionId = DB::table('permissions')->where('key', 'notifications.view')->value('id');
        DB::table('role_permissions')->where('role_id', $roleId)->where('permission_id', $permissionId)->delete();
        app(PermissionService::class)->invalidateUser($alice->id);

        $this->actingAs($alice, 'sanctum')->getJson('/api/v1/notifications')->assertStatus(403);
    }
}
