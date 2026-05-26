import React, { useCallback, useEffect, useState } from 'react';
import { useOrganization } from '@clerk/clerk-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

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

function getMemberName(member: MemberRecord): string {
  const firstName = member.publicUserData?.firstName?.trim() ?? '';
  const lastName = member.publicUserData?.lastName?.trim() ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  return fullName || 'Name unavailable';
}

function getMemberEmail(member: MemberRecord): string {
  return member.publicUserData?.identifier?.trim() || 'Email unavailable';
}

function getMemberRole(member: MemberRecord): string {
  return member.role?.trim() || 'Role unavailable';
}

function getMemberStatus(member: MemberRecord): string {
  return member.createdAt ? 'Active' : 'Pending';
}

function getMemberStatusVariant(member: MemberRecord): 'active' | 'pending' {
  return member.createdAt ? 'active' : 'pending';
}

export function UserManagementPage() {
  const { organization, isLoaded } = useOrganization();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [isFetchingMembers, setIsFetchingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const fetchMembers = useCallback(
    async (isActive: () => boolean) => {
      if (!organization) return;

      setIsFetchingMembers(true);
      setMembersError(null);
      try {
        const result = await organization.getMemberships({ pageSize: 50 });
        if (!isActive()) return;
        setMembers(result.data as MemberRecord[]);
      } catch {
        if (!isActive()) return;
        setMembers([]);
        setMembersError('We could not load team members. Check the connection and try again.');
      } finally {
        if (isActive()) {
          setIsFetchingMembers(false);
        }
      }
    },
    [organization],
  );

  useEffect(() => {
    if (!organization) {
      setMembers([]);
      setMembersError(null);
      setIsFetchingMembers(false);
      return undefined;
    }

    let isActive = true;
    fetchMembers(() => isActive);

    return () => {
      isActive = false;
    };
  }, [organization, fetchMembers]);

  const handleRetryMembers = useCallback(() => {
    fetchMembers(() => true);
  }, [fetchMembers]);

  return (
    <main
      className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8"
      aria-labelledby="team-members-heading"
    >
      <div className="mb-4 sm:mb-6">
        <h1
          id="team-members-heading"
          className="text-xl font-semibold font-heading text-semantic-text-primary sm:text-2xl"
        >
          Team members
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-semantic-text-secondary sm:text-base">
          Manage your organization members and their roles.
        </p>
      </div>

      {!isLoaded || !organization ? (
        <Card>
          <CardContent className="pt-6">
            <p
              role="status"
              aria-label="Loading organization"
              className="text-center text-semantic-text-tertiary"
            >
              Loading organization...
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="px-4 sm:px-6">
            <CardTitle className="text-lg font-semibold">Organization members</CardTitle>
            <CardDescription className="max-w-3xl">
              Members in {organization.name}. To invite new team members, use the Settings tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            {isFetchingMembers ? (
              <p
                role="status"
                aria-label="Loading team members"
                className="text-center text-semantic-text-tertiary"
              >
                Loading team members...
              </p>
            ) : membersError ? (
              <div
                role="alert"
                aria-label="We could not load team members"
                className="grid gap-3 rounded-md border border-semantic-critical/30 bg-semantic-critical/10 p-4 text-center"
              >
                <p className="text-sm text-semantic-critical">{membersError}</p>
                <div>
                  <Button onClick={handleRetryMembers} className="min-h-11 w-full sm:w-auto">
                    Try again
                  </Button>
                </div>
              </div>
            ) : members.length > 0 ? (
              <>
                <ul aria-label="Team member summaries" className="grid gap-3 md:hidden">
                  {members.map((membership) => {
                    const name = getMemberName(membership);
                    const email = getMemberEmail(membership);
                    const role = getMemberRole(membership);
                    const status = getMemberStatus(membership);

                    return (
                      <li
                        key={membership.id}
                        aria-label={`${name}, ${role}, ${status}`}
                        className="rounded-md border border-hairline bg-semantic-surface-1 p-3"
                      >
                        <div className="grid gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                              Member
                            </p>
                            <p className="break-words text-sm font-medium text-semantic-text-primary">
                              {name}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                              Email
                            </p>
                            <p className="break-all text-sm text-semantic-text-primary">{email}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                                Role
                              </p>
                              <p className="break-words text-sm capitalize text-semantic-text-primary">
                                {role}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                                Status
                              </p>
                              <Badge variant={getMemberStatusVariant(membership)}>{status}</Badge>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden md:block">
                  <Table aria-label="Organization member details">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((membership) => (
                        <TableRow key={membership.id}>
                          <TableCell className="max-w-56 whitespace-normal break-words">
                            {getMemberName(membership)}
                          </TableCell>
                          <TableCell className="max-w-64 break-all">
                            {getMemberEmail(membership)}
                          </TableCell>
                          <TableCell className="max-w-52 whitespace-normal break-words capitalize">
                            {getMemberRole(membership)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getMemberStatusVariant(membership)}>
                              {getMemberStatus(membership)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <p
                role="status"
                aria-label="No team members found"
                className="text-center text-semantic-text-tertiary"
              >
                No team members found in this organization. Use Settings to invite the first team
                member.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
