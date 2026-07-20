// index.tsx
import './instrument'; // Correct: This must stay at the top!
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { ClerkAuthProvider } from './components/ClerkAuthProvider';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import * as Sentry from '@sentry/react';

const CLERK_PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

export function MissingClerkConfiguration() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto max-w-2xl rounded-md border bg-semantic-surface-1 p-6 shadow-sm">
        <div role="alert" aria-live="assertive">
          <h1 className="font-heading text-2xl font-semibold">
            Add REACT_APP_CLERK_PUBLISHABLE_KEY to start the app
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The frontend cannot initialize Clerk authentication without a publishable key. Add it to
            your local environment, then restart the dev server.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Find the value in Clerk dashboard API keys. Do not commit the key to source control.
          </p>
        </div>
      </section>
    </main>
  );
}

function renderApp() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <MissingClerkConfiguration />;
  }

  return (
    <ClerkAuthProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
        <App />
      </Sentry.ErrorBoundary>
    </ClerkAuthProvider>
  );
}

root.render(<React.StrictMode>{renderApp()}</React.StrictMode>);

serviceWorkerRegistration.register();
reportWebVitals();
