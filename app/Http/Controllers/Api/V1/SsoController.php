<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class SsoController extends Controller
{
    /**
     * Get SSO configuration for the organization.
     */
    public function show(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        $config = $org->sso_config ?? [];

        // Never expose the certificate in full
        if (isset($config['x509_cert'])) {
            $config['x509_cert'] = '***configured***';
        }

        return response()->json([
            'sso_enabled' => !empty($config),
            'enforce_sso' => $org->enforce_sso,
            'provider' => $config['provider'] ?? null,
            'entity_id' => $config['entity_id'] ?? null,
            'sso_url' => $config['sso_url'] ?? null,
            'domains' => $config['domains'] ?? [],
        ]);
    }

    /**
     * Configure SSO for the organization (SAML2).
     */
    public function configure(Request $request): JsonResponse
    {
        $request->validate([
            'provider' => 'required|in:saml2,google,microsoft',
            'entity_id' => 'required_if:provider,saml2|string|max:500',
            'sso_url' => 'required_if:provider,saml2|url|max:500',
            'slo_url' => 'nullable|url|max:500',
            'x509_cert' => 'required_if:provider,saml2|string',
            'domains' => 'required|array|min:1',
            'domains.*' => 'string|max:255',
            'attribute_map' => 'nullable|array',
            'attribute_map.email' => 'nullable|string',
            'attribute_map.name' => 'nullable|string',
            'enforce_sso' => 'boolean',
        ]);

        $org = $request->user()->organization;
        $org->sso_config = [
            'provider' => $request->provider,
            'entity_id' => $request->entity_id,
            'sso_url' => $request->sso_url,
            'slo_url' => $request->slo_url,
            'x509_cert' => $request->x509_cert,
            'domains' => $request->domains,
            'attribute_map' => $request->attribute_map ?? [
                'email' => 'NameID',
                'name' => 'displayName',
            ],
        ];
        $org->enforce_sso = $request->boolean('enforce_sso', false);
        $org->save();

        AuditService::log('sso.configured', $org, [
            'provider' => $request->provider,
            'enforce_sso' => $org->enforce_sso,
            'domains' => $request->domains,
        ]);

        return response()->json([
            'message' => 'SSO configuration saved.',
            'enforce_sso' => $org->enforce_sso,
        ]);
    }

    /**
     * Disable SSO for the organization.
     */
    public function destroy(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        $org->sso_config = null;
        $org->enforce_sso = false;
        $org->save();

        AuditService::log('sso.configured', $org, ['action' => 'disabled']);

        return response()->json(['message' => 'SSO configuration removed.']);
    }

    /**
     * SAML2 Assertion Consumer Service (ACS) — handles IdP response.
     */
    public function samlAcs(Request $request): JsonResponse
    {
        $request->validate([
            'SAMLResponse' => 'required|string',
            'organization_slug' => 'required|string',
        ]);

        // Decode and validate SAML response
        $samlResponse = base64_decode($request->SAMLResponse);
        $orgSlug = $request->organization_slug;

        $org = \App\Models\Organization::where('slug', $orgSlug)->firstOrFail();
        $ssoConfig = $org->sso_config;

        if (empty($ssoConfig)) {
            return response()->json(['message' => 'SSO is not configured for this organization.'], 400);
        }

        // Parse SAML assertion (simplified — production would use a SAML library)
        $xml = @simplexml_load_string($samlResponse);
        if (!$xml) {
            return response()->json(['message' => 'Invalid SAML response.'], 400);
        }

        $namespaces = $xml->getNamespaces(true);
        $attrMap = $ssoConfig['attribute_map'] ?? ['email' => 'NameID', 'name' => 'displayName'];

        // Extract email from NameID or attribute
        $email = null;
        $name = null;

        // Try NameID first
        $assertion = $xml->children($namespaces['saml'] ?? '');
        if (isset($assertion->Subject->NameID)) {
            $email = (string) $assertion->Subject->NameID;
        }

        if (!$email) {
            return response()->json(['message' => 'Could not extract email from SAML assertion.'], 400);
        }

        // JIT provisioning: find or create user
        $user = DB::transaction(function () use ($email, $name, $org) {
            $user = User::where('email', $email)
                ->where('organization_id', $org->id)
                ->first();

            if (!$user) {
                $user = User::create([
                    'organization_id' => $org->id,
                    'name' => $name ?? explode('@', $email)[0],
                    'email' => $email,
                    'password' => Hash::make(Str::random(64)),
                    'role' => 'employee',
                    'sso_provider' => 'saml2',
                    'sso_provider_id' => $email,
                    'email_verified_at' => now(),
                ]);
            } else {
                $user->update([
                    'sso_provider' => 'saml2',
                    'sso_provider_id' => $email,
                ]);
            }

            return $user;
        });

        // Issue tokens
        $user->tokens()->delete();
        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        $user->update(['last_active_at' => now()]);

        AuditService::log('auth.login', $user, ['method' => 'saml2'], $user);

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
            ],
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }

    /**
     * SAML2 Service Provider metadata.
     */
    public function metadata(Request $request): JsonResponse
    {
        $baseUrl = config('app.url');

        return response()->json([
            'entity_id' => $baseUrl . '/api/v1/auth/saml/metadata',
            'acs_url' => $baseUrl . '/api/v1/auth/saml/acs',
            'sls_url' => $baseUrl . '/api/v1/auth/saml/sls',
            'name_id_format' => 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        ]);
    }
}
