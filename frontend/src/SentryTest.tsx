import React, { useState } from 'react';
import * as Sentry from '@sentry/react';

const SentryTest: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  const triggerFrontendError = () => {
    try {
      // This will throw a ReferenceError
      throw new Error('Test frontend error');
    } catch (err) {
      Sentry.captureException(err);
      setError('Frontend error triggered and sent to Sentry');
    }
  };

  const triggerUnhandledError = () => {
    // This will cause an unhandled error that Sentry should catch
    throw new Error('Test unhandled error from React component');
  };

  const testWorkersError = async () => {
    const workersUrl = process.env.REACT_APP_WORKERS_URL;

    if (!workersUrl) {
      setError('Workers URL not configured. Please set REACT_APP_WORKERS_URL in your .env file.');
      return;
    }

    try {
      // Make a request to the deployed Workers endpoint that will throw an error
      const response = await fetch(`${workersUrl}/api/test-error`);

      if (response.ok) {
        // If we get a 200 response, something is wrong
        const text = await response.text();
        setError(`Unexpected success response: ${text}`);
        return;
      }

      // We expect a 500 error response from the Workers error
      if (response.status === 500) {
        // This is expected - the Workers endpoint threw an error and returned 500
        const errorData = await response.json().catch(() => ({ error: 'Internal Server Error' }));
        Sentry.captureMessage(
          `Workers error test successful: ${errorData.error || 'Internal Server Error'}`,
          'info',
        );
        setError(
          `Workers error triggered successfully: ${errorData.error || 'Internal Server Error'}`,
        );
      } else {
        // Unexpected status code
        const text = await response.text();
        setError(`Unexpected response status ${response.status}: ${text}`);
      }
    } catch (err) {
      // Network error or other fetch failure
      Sentry.captureException(err);
      setError(
        `Network error testing Workers: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-semibold mb-4">Sentry Integration Test</h2>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Frontend Tests (@sentry/react)</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={triggerFrontendError}
              className="px-4 py-2 bg-semantic-secondary text-semantic-secondary-foreground rounded hover:bg-semantic-secondary-hover"
            >
              Trigger Handled Error
            </button>
            <button
              onClick={triggerUnhandledError}
              className="px-4 py-2 bg-semantic-critical text-semantic-critical-foreground rounded hover:bg-semantic-critical-hover"
            >
              Trigger Unhandled Error
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-2">Workers Tests (@sentry/cloudflare)</h3>
          <button
            onClick={testWorkersError}
            className="px-4 py-2 bg-semantic-success text-semantic-success-foreground rounded hover:bg-semantic-success-hover"
          >
            Test Workers Error
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-semantic-warning-muted border border-semantic-warning-muted rounded">
            <p className="text-semantic-warning-muted-foreground">{error}</p>
          </div>
        )}
      </div>

      <div className="mt-8 p-4 bg-semantic-surface-2 rounded">
        <h3 className="text-lg font-semibold mb-2">How to Verify:</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Click buttons to trigger errors</li>
          <li>Check browser console for Sentry logs</li>
          <li>Check Sentry dashboard for new events</li>
          <li>Look for different project IDs for frontend vs workers</li>
          <li>Frontend errors should show React component stack traces</li>
          <li>Workers errors should show Cloudflare Workers context</li>
        </ol>
      </div>
    </div>
  );
};

export default SentryTest;
