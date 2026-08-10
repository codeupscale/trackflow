<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

/**
 * GET /api/v1/agent/config — the idle policy handed to the desktop agent.
 *
 * Crediting idle time as work was removed by owner policy (2026-07-16): the desktop
 * offers only "Continue tracking" and "Stop timer", and both discard the idle gap.
 * The `keep_idle_time = always` setting predates that and was the one surviving path
 * that still billed it, so it is folded into `never` HERE — at the single place every
 * build reads its policy from — rather than only in the new agent, which would leave
 * every not-yet-updated desktop still billing idle minutes.
 */
class AgentIdlePolicyTest extends TestCase
{
    private const URL = '/api/v1/agent/config';

    private function actingAsAgentUser(?string $keepIdleTime): User
    {
        $org = $this->createOrganization();

        if ($keepIdleTime !== null) {
            $org->settings = array_merge($org->settings ?? [], [
                'keep_idle_time' => $keepIdleTime,
            ]);
            $org->save();
        }

        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    public function test_always_is_never_handed_to_the_agent(): void
    {
        $this->actingAsAgentUser('always');

        $this->getJson(self::URL)
            ->assertOk()
            ->assertJsonPath('keep_idle_time', 'never');
    }

    public function test_prompt_and_never_are_passed_through_unchanged(): void
    {
        $this->actingAsAgentUser('prompt');
        $this->getJson(self::URL)->assertOk()->assertJsonPath('keep_idle_time', 'prompt');

        $this->actingAsAgentUser('never');
        $this->getJson(self::URL)->assertOk()->assertJsonPath('keep_idle_time', 'never');
    }

    public function test_a_missing_or_unrecognised_policy_falls_back_to_prompt(): void
    {
        $this->actingAsAgentUser(null);
        $this->getJson(self::URL)->assertOk()->assertJsonPath('keep_idle_time', 'prompt');

        // A hand-edited or legacy value must not reach the agent as-is: an unknown
        // string would fall through the agent's switch and silently become "keep".
        $this->actingAsAgentUser('reassign');
        $this->getJson(self::URL)->assertOk()->assertJsonPath('keep_idle_time', 'prompt');
    }

    /**
     * The stored value is deliberately left alone — this is a read-side clamp, so the
     * setting can be revisited without having been destroyed.
     */
    public function test_normalising_does_not_rewrite_the_stored_setting(): void
    {
        $user = $this->actingAsAgentUser('always');

        $this->getJson(self::URL)->assertOk();

        $org = Organization::find($user->organization_id);
        $this->assertSame('always', $org->getSetting('keep_idle_time'));
    }
}
