// index.tsx
import './instrument'; // Correct: This must stay at the top!
import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind-output.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import * as Sentry from '@sentry/react';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn('Uncaught error', error, errorInfo.componentStack);
  }),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

root.render(
  <React.StrictMode>
    {/* Adding the ErrorBoundary here handles the UI crash */}
    <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);

serviceWorkerRegistration.register();
reportWebVitals();