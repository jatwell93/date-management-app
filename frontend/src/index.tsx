// Sentry initialization should be imported first!
import './instrument';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind-output.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import * as Sentry from '@sentry/react';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  // Callback called when an error is thrown and not caught by an ErrorBoundary.
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn('Uncaught error', error, errorInfo.componentStack);
  }),
  // Callback called when React catches an error in an ErrorBoundary.
  onCaughtError: Sentry.reactErrorHandler(),
  // Callback called when React automatically recovers from errors.
  onRecoverableError: Sentry.reactErrorHandler(),
});
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://cra.link/PWA
serviceWorkerRegistration.register();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more about: https://bit.ly/CRA-vitals
reportWebVitals();
