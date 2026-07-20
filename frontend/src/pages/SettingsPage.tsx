import { OrganizationProfile } from '@clerk/clerk-react';
import { responsiveClerkAppearance } from '../components/ClerkAuthPage';
import ErrorBoundary from '../components/ErrorBoundary';
import { Button } from '../components/ui/button';
import { MarkdownMatrixSettings } from '../components/MarkdownMatrixSettings';

function SettingsControlsFallback() {
  return (
    <div
      role="alert"
      className="w-full rounded-md border border-semantic-critical/30 bg-semantic-critical-muted p-4 text-semantic-critical-muted-foreground"
    >
      <h2 className="break-words text-lg font-semibold font-heading text-semantic-critical">
        Workspace settings could not be loaded.
      </h2>
      <p className="mt-2 max-w-prose break-words text-sm">
        Reload settings before changing team members or roles. If this keeps happening, check your
        connection and try again.
      </p>
      <Button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 min-h-11 w-full font-semibold sm:w-auto"
      >
        Reload settings
      </Button>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div
      data-testid="settings-shell"
      className="mx-auto min-w-0 w-full max-w-5xl overflow-x-hidden rounded-lg border border-hairline bg-semantic-surface-1 px-3 py-4 sm:px-4 sm:py-6"
    >
      <header className="mb-5 min-w-0 max-w-3xl sm:mb-6">
        <h1 className="break-words text-2xl font-semibold font-heading text-semantic-text-primary">
          Workspace settings
        </h1>
        <p className="mt-1 max-w-prose break-words text-semantic-text-secondary">
          Manage pharmacy workspace details, team access, and roles.
        </p>
      </header>

      <section
        aria-label="Pharmacy workspace controls"
        className="clerk-responsive-surface settings-clerk-adapter min-w-0"
      >
        <ErrorBoundary fallback={<SettingsControlsFallback />}>
          <OrganizationProfile
            routing="path"
            path="/settings"
            appearance={responsiveClerkAppearance}
          />
        </ErrorBoundary>
      </section>

      <section aria-label="Markdown matrix" className="mt-6 min-w-0">
        <ErrorBoundary fallback={<SettingsControlsFallback />}>
          <MarkdownMatrixSettings />
        </ErrorBoundary>
      </section>
    </div>
  );
}
