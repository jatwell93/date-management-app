const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// Skip Sentry initialization in test environment to avoid instrumentation warnings
if (process.env.NODE_ENV !== 'test') {
  // Ensure to call this before requiring any other modules!
  Sentry.init({
  dsn: 'https://c062ac296f7c9bbe618c5f1fe824ea59@o4510816588922880.ingest.us.sentry.io/4510816590692352',

  // Adds request headers and IP for users
  sendDefaultPii: true,

  // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing.
  tracesSampleRate: 1.0,

  // Set profilesSampleRate to 1.0 to profile 100% of sampled transactions.
  // This is relative to tracesSampleRate
  profilesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  integrations: [
    // Add our Profiling integration
    nodeProfilingIntegration(),
  ],
  });
}
