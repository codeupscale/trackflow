import posthog from 'posthog-js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (typeof window !== 'undefined' && key) {
  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: false,
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

  posthog.group('organization', user.organization.id, {
    name: user.organization.name,
    plan: user.organization.plan,
  });
}

export function resetUser() {
  if (typeof window === 'undefined' || !key) return;
  posthog.reset();
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !key) return;
  posthog.capture(event, properties);
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !key) return;
  posthog.capture('$exception', {
    $exception_message: error.message,
    $exception_type: error.name,
    $exception_stack_trace_raw: error.stack,
    ...context,
  });
}

export default posthog;
