<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BackfillSystemRolesTest extends TestCase
{
    private function runBackfill(): void
    {
        $migration = require database_path(
            'migrations/2026_07_24_131516_backfill_missing_system_roles_for_all_orgs.php'
        );
        $migration->up();
    }

    private function roleNames(string $orgId): array
    {
        return DB::table('roles')->where('organization_id', $orgId)->pluck('name')->all();
    }

    public function test_backfill_recreates_missing_system_roles_with_permissions(): void
    {
        $org = $this->createOrganization(); // seeds all 5 system roles

        // Simulate a pre-2026-05-13 org that never got the two new roles.
        DB::table('roles')
            ->where('organization_id', $org->id)
            ->whereIn('name', ['hr_manager', 'finance_manager'])
            ->delete();

        $before = $this->roleNames($org->id);
        $this->assertNotContains('hr_manager', $before);
        $this->assertNotContains('finance_manager', $before);

        $this->runBackfill();

        $after = $this->roleNames($org->id);
        foreach (['owner', 'org_manager', 'hr_manager', 'finance_manager', 'employee'] as $name) {
            $this->assertContains($name, $after, "Org must have the {$name} role after backfill.");
        }

        // A recreated manager role gets its permission grants (owner stays bypass/empty).
        $hrId = DB::table('roles')->where('organization_id', $org->id)->where('name', 'hr_manager')->value('id');
        $this->assertGreaterThan(0, DB::table('role_permissions')->where('role_id', $hrId)->count());
    }

    public function test_backfill_is_idempotent_and_creates_no_duplicates(): void
    {
        $org = $this->createOrganization();

        // Run twice on an org that already has all five — must be a no-op.
        $this->runBackfill();
        $this->runBackfill();

        foreach (['owner', 'org_manager', 'hr_manager', 'finance_manager', 'employee'] as $name) {
            $count = DB::table('roles')
                ->where('organization_id', $org->id)
                ->where('name', $name)
                ->count();
            $this->assertEquals(1, $count, "Exactly one {$name} role must exist (no duplicates).");
        }
    }
}
