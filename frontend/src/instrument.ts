import * as Sentry from '@sentry/react';

// Initialize Sentry for frontend error tracking
const sentryDsn = process.env.REACT_APP_SENTRY_FRONTEND_DSN;

if (sentryDsn && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: sentryDsn,

    // Adds user context to errors
    sendDefaultPii: true,

    // Set tracesSampleRate to capture a fraction of transactions for performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 1.0,

    // Enable profiling (helpful for identifying slow pages)
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.5,

    // Environment tag for organizing errors in Sentry dashboard
    environment: process.env.NODE_ENV || 'development',

    // Release tracking for better source map linkage
    release: process.env.REACT_APP_VERSION || 'unknown',

    // These are additional integrations for React-specific error handling
    integrations: [
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Capture 10% of replay sessions for error events; 100% when sampling
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
