const mockSentryInit = jest.fn();
const mockBrowserTracingIntegration = jest.fn(() => ({ name: 'browser-tracing' }));
const mockReplayIntegration = jest.fn(() => ({ name: 'session-replay' }));
const mockFeedbackIntegration = jest.fn((_options?: unknown) => ({ name: 'feedback-widget' }));

jest.mock('@sentry/react', () => ({
  init: (options?: unknown) => mockSentryInit(options),
  browserTracingIntegration: () => mockBrowserTracingIntegration(),
  replayIntegration: () => mockReplayIntegration(),
  feedbackIntegration: (options?: unknown) => mockFeedbackIntegration(options),
}));

describe('Sentry feedback widget instrumentation', () => {
  const writableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.REACT_APP_SENTRY_FRONTEND_DSN;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    writableEnv.NODE_ENV = 'production';
    writableEnv.REACT_APP_SENTRY_FRONTEND_DSN = 'https://example@o0.ingest.sentry.io/0';
  });

  afterAll(() => {
    writableEnv.NODE_ENV = originalNodeEnv;
    writableEnv.REACT_APP_SENTRY_FRONTEND_DSN = originalDsn;
  });

  it('adds feedbackIntegration so users can submit issue reports from the app UI', async () => {
    await import('../instrument');

    expect(mockFeedbackIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        colorScheme: 'system',
      }),
    );
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://example@o0.ingest.sentry.io/0',
      }),
    );
  });
});

export {};
