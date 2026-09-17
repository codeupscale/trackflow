<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Who should be told.
 *
 * Notifications are addressed to USERS, but the rules that produce them are
 * written in terms of who is responsible — "the people who watch attendance",
 * "the people who run payroll". Resolving that in one place keeps the rule out
 * of the notification classes, where it would be copied and then drift.
 *
 * Resolved by PERMISSION, not by role name. TrackFlow's role set is open — an
 * org may define custom roles — so a hardcoded list of names silently excludes
 * the custom "People Ops" role that does exactly this job, and a missing
 * recipient is invisible: nobody reports the notification they never got.
 * Granting `notifications.receive_attendance` to any role, system or custom, is
 * all it takes to be included.
 *
 * One rule holds everywhere: never notify the actor about their own action.
 * Payroll already refuses to let finance verify their own payslip for the same
 * reason — a message telling you what you just did is pure noise, and noise is
 * what makes people mute a bell.
 */
class NotificationRecipients
{
    public function __construct(
        private readonly PermissionService $permissions,
    ) {}

    /**
     * Active users in the org who hold $permission.
     *
     * The candidate set is narrowed in SQL first — anyone with a role that
     * grants the key, or the owner, who bypasses the permission map in code and
     * therefore appears in no role_permissions row. Each candidate is then
     * checked through PermissionService so that the answer here is the same one
     * the middleware would give: one definition of "holds this permission",
     * not two that can disagree.
     */
    public function withPermission(string $organizationId, string $permission, ?string $exceptUserId = null): Collection
    {
        $candidates = User::withoutGlobalScopes()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->where(function ($q) use ($permission) {
                // Owners hold everything by definition and have no rows.
                $q->where('role', 'owner')
                    ->orWhereHas('assignedRoles', function ($r) use ($permission) {
                        $r->where('roles.name', 'owner')
                            ->orWhereHas('permissions', fn ($p) => $p->where('permissions.key', $permission));
                    });
            });

        if ($exceptUserId !== null) {
            $candidates->where('id', '!=', $exceptUserId);
        }

        return $candidates->get()->filter(
            fn (User $user) => $this->permissions->hasPermission($user, $permission)
        )->values();
    }

    /**
     * The people told about organisation activity — the owner and HR.
     *
     * One audience, one method, because every category in this stream has the
     * same one: joiners, departments, job posts, leave, attendance, payroll,
     * shifts. Splitting it per category would be several ways to spell the
     * same rule, and they would drift the first time one was edited.
     */
    public function orgActivityWatchers(string $organizationId, ?string $exceptUserId = null): Collection
    {
        return $this->withPermission($organizationId, 'notifications.receive_org_activity', $exceptUserId);
    }

    /**
     * Who an employee may name as having approved an early departure.
     *
     * Keyed on `leave.approve` — the people who already authorise time away
     * from work, which is the owner, the org manager and HR. Leaving three
     * hours early and taking a half-day off are the same decision at different
     * scales, so they should not have two different sets of approvers.
     *
     * Finance is deliberately outside it: they read attendance for payroll,
     * they do not authorise anyone's hours. (`attendance.manage_policy` would
     * have been the closer name, but that permission was removed in July 2026 —
     * resolving against a key nothing grants would have returned the owner
     * alone and silently hidden HR from the picker.)
     */
    public function earlyCheckoutApprovers(string $organizationId, ?string $exceptUserId = null): Collection
    {
        return $this->withPermission($organizationId, 'leave.approve', $exceptUserId);
    }
}
