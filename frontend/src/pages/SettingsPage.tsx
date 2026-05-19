import { OrganizationProfile } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold font-heading text-semantic-text-primary">
          Organisation Settings
        </h1>
        <p className="mt-1 text-semantic-text-secondary">
          Manage your organisation profile, members, and roles.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Organisation Profile</CardTitle>
          <CardDescription>
            Invite team members, manage roles, and update your organisation details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationProfile routing="path" path="/settings" />
        </CardContent>
      </Card>
    </div>
  );
}
