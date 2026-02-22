import { CreateOrganization } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function OnboardingPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-2xl px-4">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Welcome to Inventory Manager</h1>
          <p className="mt-2 text-gray-600">
            Create your organisation to get started. You can invite team members after setup.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Set Up Your Organisation</CardTitle>
            <CardDescription>
              Your organisation groups your team and inventory data together. You&apos;ll be the
              admin and can invite others once it&apos;s created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrganization
              routing="path"
              path="/onboarding"
              afterCreateOrganizationUrl="/scan"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
