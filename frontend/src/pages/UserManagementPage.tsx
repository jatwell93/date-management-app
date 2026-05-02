import React from 'react';
import { useOrganization } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

interface UserManagementPageProps {
  token: string | null;
}

export function UserManagementPage({ token }: UserManagementPageProps) {
  const { organization } = useOrganization();

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
        <p className="mt-1 text-gray-600">Manage your organization members and their roles.</p>
      </div>

      {!organization ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-gray-500">Loading organization...</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Organization Members</CardTitle>
            <CardDescription>
              Members in {organization.name}. To invite new team members, use the Settings tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {organization.memberships && organization.memberships.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4 font-semibold">Name</th>
                      <th className="text-left py-2 px-4 font-semibold">Email</th>
                      <th className="text-left py-2 px-4 font-semibold">Role</th>
                      <th className="text-left py-2 px-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organization.memberships.map((membership) => (
                      <tr key={membership.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-4">
                          {membership.publicUserData?.firstName}{' '}
                          {membership.publicUserData?.lastName}
                        </td>
                        <td className="py-2 px-4">{membership.publicUserData?.email}</td>
                        <td className="py-2 px-4 capitalize">{membership.role}</td>
                        <td className="py-2 px-4 capitalize">
                          {membership.createdAt ? 'Active' : 'Pending'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-gray-500">No members found in this organization.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
