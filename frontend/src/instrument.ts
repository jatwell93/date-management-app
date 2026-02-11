import * as Sentry from '@sentry/react';

const sentryDsn = process.env.REACT_APP_SENTRY_FRONTEND_DSN;

if (sentryDsn && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: sentryDsn,

    // Recommended: Modern functional integrations
    integrations: [
      // Captures performance data for page loads and navigations
      Sentry.browserTracingIntegration(),
      // Replaces 'new Sentry.Replay()'
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Adds user context to errors (IP address, etc.)
    sendDefaultPii: true,

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 1.0,

    // Profiling (keep this if you have the @sentry/profiling-node or browser equivalent)
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.5,

    environment: process.env.NODE_ENV || 'development',
    release: process.env.REACT_APP_VERSION || 'unknown',

    // Session Replay settings
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
