const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// Skip Sentry initialization in test environment to avoid instrumentation warnings
if (process.env.NODE_ENV !== 'test') {
  const sentryDsn = process.env.SENTRY_DSN;

  // Only initialize Sentry if DSN is provided
  if (sentryDsn) {
    // Ensure to call this before requiring any other modules!
    Sentry.init({
      dsn: sentryDsn,

      // Adds request headers and IP for users
      sendDefaultPii: true,

      // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing.
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 1.0,

      // Set profilesSampleRate to 1.0 to profile 100% of sampled transactions.
      // This is relative to tracesSampleRate
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.5,

      // Enable logs to be sent to Sentry
      enableLogs: true,

      // Environment tag for better organization in Sentry dashboard
      environment: process.env.NODE_ENV || 'development',

      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
      ],
    });
  }
}
