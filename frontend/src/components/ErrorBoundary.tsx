import React from 'react';
import * as Sentry from '@sentry/react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Also mirror to the browser console so developers can debug without
    // cracking open Sentry. Without this, render exceptions produce a bare
    // "Something went wrong" page with no clue in DevTools.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught render exception:', error, errorInfo);

    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full bg-card text-card-foreground p-6 rounded-lg shadow-md text-center">
            <h2 className="text-2xl font-bold font-heading mb-4">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              We're sorry, but something went wrong. Please try refreshing the page or contact
              support if the issue persists.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
