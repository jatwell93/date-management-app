import React, { useEffect, useState } from 'react';
import { useOrganization } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

interface MemberRecord {
  id: string;
  role: string;
  createdAt: Date | null;
  publicUserData?: {
    firstName?: string | null;
    lastName?: string | null;
    identifier?: string | null;
  } | null;
}

export function UserManagementPage() {
  const { organization, isLoaded } = useOrganization();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [isFetchingMembers, setIsFetchingMembers] = useState(false);

  useEffect(() => {
    if (!organization) return;
    setIsFetchingMembers(true);
    organization
      .getMemberships({ pageSize: 50 })
      .then((result) => {
        setMembers(result.data as MemberRecord[]);
      })
      .catch(() => {
        setMembers([]);
      })
      .finally(() => {
        setIsFetchingMembers(false);
      });
  }, [organization]);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-semantic-text-primary">Team Members</h1>
        <p className="mt-1 text-semantic-text-secondary">
          Manage your organization members and their roles.
        </p>
      </div>

      {!isLoaded || !organization ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-semantic-text-tertiary">Loading organization...</p>
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
            {isFetchingMembers ? (
              <p className="text-center text-semantic-text-tertiary">Loading members...</p>
            ) : members.length > 0 ? (
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
                    {members.map((membership) => (
                      <tr key={membership.id} className="border-b hover:bg-semantic-surface-2">
                        <td className="py-2 px-4">
                          {membership.publicUserData?.firstName}{' '}
                          {membership.publicUserData?.lastName}
                        </td>
                        <td className="py-2 px-4">{membership.publicUserData?.identifier}</td>
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
              <p className="text-center text-semantic-text-tertiary">
                No members found in this organization.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
