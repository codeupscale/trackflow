import posthog from 'posthog-js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (typeof window !== 'undefined' && key) {
  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,

    // Security: disable autocapture to prevent accidental form value collection
    autocapture: false,

    // Security: disable session recording to prevent capturing sensitive screen content
    // (passwords, tokens, org data visible on dashboard). Enable only after configuring
    // PostHog privacy controls (maskAllInputs, blockSelector for sensitive components).
    disable_session_recording: true,

    // If session recording is ever re-enabled, enforce these privacy defaults:
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-sensitive]',
    },
  });
}

export function getPostHogClient() {
  if (typeof window === 'undefined' || !key) return null;
  return posthog;
}

interface PostHogUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organization_id: string;
  organization: {
    id: string;
    name: string;
    plan: string;
  };
}

export function identifyUser(user: PostHogUser) {
  if (typeof window === 'undefined' || !key) return;

  posthog.identify(user.id, {
    email: user.email,
    name: user.name,
    role: user.role,
    organization_id: user.organization_id,
  });

  if (user.organization?.id) {
    posthog.group('organization', user.organization.id, {
      name: user.organization.name,
      plan: user.organization.plan,
    });
  }
}

export function resetUser() {
  if (typeof window === 'undefined' || !key) return;
  posthog.reset();
}

// Keys that must never be sent to analytics (case-insensitive check)
const BLOCKED_PROPERTY_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'authorization',
  'cookie',
  'credit_card',
  'ssn',
  'api_key',
]);

function sanitizeProperties(
  props?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!BLOCKED_PROPERTY_KEYS.has(k.toLowerCase())) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !key) return;
  posthog.capture(event, sanitizeProperties(properties));
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !key) return;
  posthog.capture('$exception', {
    $exception_message: error.message,
    $exception_type: error.name,
    $exception_stack_trace_raw: error.stack,
    ...sanitizeProperties(context),
  });
}

export default posthog;
