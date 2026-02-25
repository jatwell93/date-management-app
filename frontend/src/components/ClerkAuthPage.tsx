import { SignIn, SignUp } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export function ClerkSignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Date Management App</CardTitle>
            <CardDescription className="text-center">
              Manage inventory dates and compliance in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignUp routing="path" path="/sign-up" signInUrl="/login" fallbackRedirectUrl="/scan" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ClerkSignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Date Management App</CardTitle>
            <CardDescription className="text-center">
              Manage inventory dates and compliance in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignIn routing="path" path="/login" signUpUrl="/sign-up" fallbackRedirectUrl="/scan" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
