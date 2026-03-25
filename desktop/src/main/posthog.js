// PostHog analytics service — singleton, graceful degradation, never crashes the app
//
// Usage:
//   const posthog = require('./posthog');
//   posthog.init('phc_xxx', { host: 'https://us.i.posthog.com' });
//   posthog.identify(userId, { email, name, role, organization_id });
//   posthog.capture(userId, 'timer_started', { project_id });
//   await posthog.shutdown();

const os = require('os');
const { PostHog } = require('posthog-node');

let client = null;
let _distinctId = null;
let _platformProps = null;

module.exports = {
  /**
   * Initialize PostHog with API key and options.
   * Call once during app startup. If apiKey is falsy, all methods remain no-ops.
   * @param {string} apiKey - PostHog project API key
   * @param {object} options - { host?: string }
   */
  init(apiKey, options = {}) {
    try {
      if (!apiKey) return;

      client = new PostHog(apiKey, {
        host: options.host || 'https://us.i.posthog.com',
        flushAt: 10,
        flushInterval: 30000,
      });

      // Cache platform props once at init — avoids re-reading on every capture
      let appVersion = '0.0.0';
      try {
        appVersion = require('../../package.json').version;
      } catch (_) {
        // package.json read can fail in packaged app edge cases
      }

      _platformProps = {
        $os: process.platform,
        $os_version: os.release(),
        app_version: appVersion,
        arch: process.arch,
        electron_version: process.versions.electron || 'unknown',
      };
    } catch (_) {
      client = null;
    }
  },

  /**
   * Identify the current user. Call after login/auth.
   * @param {string} userId - User's UUID
   * @param {object} properties - User properties for PostHog person profile
   */
  identify(userId, properties = {}) {
    try {
      if (!client || !userId) return;
      _distinctId = userId;
      client.identify({ distinctId: userId, properties });
    } catch (_) {
      // silent
    }
  },

  /**
   * Capture a named event.
   * @param {string} distinctId - User's UUID
   * @param {string} event - Event name (e.g., 'timer_started')
   * @param {object} properties - Event properties
   */
  capture(distinctId, event, properties = {}) {
    try {
      if (!client) return;
      const id = distinctId || _distinctId || 'anonymous';
      client.capture({
        distinctId: id,
        event,
        properties: {
          ...(_platformProps || {}),
          ...properties,
        },
      });
    } catch (_) {
      // silent
    }
  },

  /**
   * Capture an error/exception event.
   * @param {string} distinctId - User's UUID (can be 'anonymous' if not logged in)
   * @param {Error|string} error - The error
   * @param {object} context - Additional context
   */
  captureError(distinctId, error, context = {}) {
    try {
      if (!client) return;
      const id = distinctId || _distinctId || 'anonymous';
      const isError = error instanceof Error;
      client.capture({
        distinctId: id,
        event: '$exception',
        properties: {
          ...(_platformProps || {}),
          $exception_message: isError ? error.message : String(error),
          $exception_type: isError ? error.name : 'Error',
          $exception_stack_trace_raw: isError ? error.stack : undefined,
          ...context,
        },
      });
    } catch (_) {
      // silent
    }
  },

  /**
   * Flush pending events and shutdown. Call on app quit.
   */
  async shutdown() {
    try {
      if (!client) return;
      // Guard with a timeout so a network-stalled flush never blocks app exit
      await Promise.race([
        client.shutdown(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      client = null;
    } catch (_) {
      client = null;
    }
  },
};
