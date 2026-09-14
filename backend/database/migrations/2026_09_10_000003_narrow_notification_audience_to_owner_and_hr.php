<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Replace the two receive_* notification keys with one, and narrow who holds it.
 *
 * The original split — receive_attendance for org_manager + hr_manager,
 * receive_payroll for finance_manager — was drawn from who READS each screen.
 * The owner's decision (2026-09-10) is that this whole stream belongs to the
 * people who own the organization and the people who run HR, and to nobody
 * else: an org manager and a finance manager keep their bell for things
 * addressed to them personally, but are not told about every joiner, leave
 * request and check-in.
 *
 * Worth stating plainly, because it is the one that looks wrong: FINANCE no
 * longer receives payroll notifications, even though finance is usually who
 * RUNS payroll. That is deliberate and was asked for explicitly. Whoever runs
 * a payroll is standing at the screen watching it run — the notification is for
 * the people who are not.
 *
 * Custom roles are untouched, which is the point of using a permission: an org
 * that wants its own role in this stream grants the key.
 */
return new class extends Migration
{
    private const NEW_KEY = 'notifications.receive_org_activity';

    private const RETIRED_KEYS = [
        'notifications.receive_attendance',
        'notifications.receive_payroll',
    ];

    public function up(): void
    {
        $now = now();

        if (! DB::table('permissions')->where('key', self::NEW_KEY)->exists()) {
            DB::table('permissions')->insert([
                'id' => Str::uuid()->toString(),
                'key' => self::NEW_KEY,
                'module' => 'notifications',
                'action' => 'receive_org_activity',
                'description' => 'Be notified about organisation activity: joiners, leave, attendance, payroll, shifts, departments and job posts',
                'has_scope' => false,
            ]);
        }

        $permissionId = DB::table('permissions')->where('key', self::NEW_KEY)->value('id');

        // HR only. The owner bypasses the permission map in code and holds
        // everything by definition — giving it a row here would be the first
        // exception to that rule.
        $hrRoleIds = DB::table('roles')
            ->where('name', 'hr_manager')
            ->where('is_system', true)
            ->pluck('id');

        foreach ($hrRoleIds as $roleId) {
            $exists = DB::table('role_permissions')
                ->where('role_id', $roleId)
                ->where('permission_id', $permissionId)
                ->exists();

            if ($exists) {
                continue;
            }

            DB::table('role_permissions')->insert([
                'id' => Str::uuid()->toString(),
                'role_id' => $roleId,
                'permission_id' => $permissionId,
                'scope' => 'none',
                'created_at' => $now,
            ]);
        }

        // Retire the old keys wholesale. They shipped in this same unreleased
        // cycle, so there is no org that has deliberately granted them to a
        // custom role and no history worth preserving.
        $retiredIds = DB::table('permissions')->whereIn('key', self::RETIRED_KEYS)->pluck('id');

        if ($retiredIds->isNotEmpty()) {
            DB::table('role_permissions')->whereIn('permission_id', $retiredIds)->delete();
            DB::table('permissions')->whereIn('id', $retiredIds)->delete();
        }
    }

    public function down(): void
    {
        // Deliberately irreversible. Rolling back would re-grant a stream to
        // roles the owner has decided must not receive it, and the two retired
        // keys have no code left that reads them.
    }
};
