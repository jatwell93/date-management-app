// index.tsx
import './instrument'; // Correct: This must stay at the top!
import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind-output.css';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import * as Sentry from '@sentry/react';

const CLERK_PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing Clerk Publishable Key in REACT_APP_CLERK_PUBLISHABLE_KEY environment variable. ' +
    'Get it from https://dashboard.clerk.com/last-active?path=api-keys',
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      {/* Adding the ErrorBoundary here handles the UI crash */}
      <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
        <App />
      </Sentry.ErrorBoundary>
    </ClerkProvider>
  </React.StrictMode>,
);

serviceWorkerRegistration.register();
reportWebVitals();
