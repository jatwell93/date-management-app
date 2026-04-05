const mockSentryInit = jest.fn();
const mockBrowserTracingIntegration = jest.fn(() => ({ name: 'browser-tracing' }));
const mockReplayIntegration = jest.fn(() => ({ name: 'session-replay' }));
const mockFeedbackIntegration = jest.fn(() => ({ name: 'feedback-widget' }));

jest.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => mockSentryInit(...args),
  browserTracingIntegration: (...args: unknown[]) => mockBrowserTracingIntegration(...args),
  replayIntegration: (...args: unknown[]) => mockReplayIntegration(...args),
  feedbackIntegration: (...args: unknown[]) => mockFeedbackIntegration(...args),
}));

describe('Sentry feedback widget instrumentation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.REACT_APP_SENTRY_FRONTEND_DSN;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.REACT_APP_SENTRY_FRONTEND_DSN = 'https://example@o0.ingest.sentry.io/0';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.REACT_APP_SENTRY_FRONTEND_DSN = originalDsn;
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
