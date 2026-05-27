import { SignIn, SignUp } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export const responsiveClerkAppearance = {
  variables: {
    colorPrimary: 'oklch(49% 0.094 183)',
    colorPrimaryForeground: 'oklch(98.5% 0.006 180)',
    colorBackground: 'oklch(99% 0.004 220)',
    colorForeground: 'oklch(22% 0.042 265)',
    colorMuted: 'oklch(96.7% 0.008 220)',
    colorMutedForeground: 'oklch(45% 0.035 256)',
    colorNeutral: 'oklch(55% 0.02 250)',
    colorDanger: 'oklch(52% 0.19 25)',
    colorSuccess: 'oklch(64% 0.15 156)',
    colorWarning: 'oklch(60% 0.14 64)',
    borderRadius: '0.5rem',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  elements: {
    rootBox: 'w-full max-w-full',
    cardBox: 'w-full max-w-full',
    card: 'clerk-pharmiq-card w-full max-w-full',
    footerActionLink: 'text-semantic-primary hover:text-semantic-primary-hover',
    formButtonPrimary:
      'bg-semantic-primary text-semantic-primary-foreground hover:bg-semantic-primary-hover focus-visible:ring-semantic-primary/50',
    formFieldInput: 'border-hairline focus:border-semantic-primary focus:ring-semantic-primary/20',
    navbarButton:
      'text-semantic-text-secondary hover:text-semantic-primary aria-selected:text-semantic-primary focus-visible:ring-semantic-primary/50',
    profileSectionPrimaryButton:
      'text-semantic-primary hover:text-semantic-primary-hover focus-visible:ring-semantic-primary/50',
    menuButton: 'focus-visible:ring-semantic-primary/50',
  },
};

export function ClerkSignUpPage() {
  return (
    <div
      data-testid="clerk-auth-shell"
      className="flex items-center justify-center min-h-screen bg-background overflow-x-hidden px-4"
    >
      <div
        data-testid="clerk-auth-card"
        className="clerk-responsive-surface w-full max-w-full sm:max-w-md"
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center font-display">
              Date Management App
            </CardTitle>
            <CardDescription className="text-center">
              Manage inventory dates and compliance in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/login"
              fallbackRedirectUrl="/scan"
              appearance={responsiveClerkAppearance}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ClerkSignInPage() {
  return (
    <div
      data-testid="clerk-auth-shell"
      className="flex items-center justify-center min-h-screen bg-background overflow-x-hidden px-4"
    >
      <div
        data-testid="clerk-auth-card"
        className="clerk-responsive-surface w-full max-w-full sm:max-w-md"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center font-display">
              Date Management App
            </CardTitle>
            <CardDescription className="text-center">
              Manage inventory dates and compliance in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignIn
              routing="path"
              path="/login"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/scan"
              appearance={responsiveClerkAppearance}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
