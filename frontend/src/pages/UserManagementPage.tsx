import React, { useCallback, useEffect, useRef, useState } from 'react';
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

function StatusMessage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p role="status" aria-label={label} className="text-center text-semantic-text-tertiary">
      {children}
    </p>
  );
}

function MemberField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-semantic-text-secondary">{label}</p>
      {children}
    </div>
  );
}

function MemberSummaryList({ members }: { members: MemberRecord[] }) {
  return (
    <ul aria-label="Team member summaries" className="grid gap-3 md:hidden">
      {members.map((membership) => (
        <li
          key={membership.id}
          className="grid gap-3 rounded-md border border-hairline bg-semantic-surface-1 p-3"
        >
          <MemberField label="Member">
            <p className="break-words text-sm font-medium text-semantic-text-primary">
              {getMemberName(membership)}
            </p>
          </MemberField>
          <MemberField label="Email">
            <p className="break-all text-sm text-semantic-text-primary">
              {getMemberEmail(membership)}
            </p>
          </MemberField>
          <div className="grid grid-cols-2 gap-3">
            <MemberField label="Role">
              <p className="break-words text-sm capitalize text-semantic-text-primary">
                {getMemberRole(membership)}
              </p>
            </MemberField>
            <MemberField label="Status">
              <Badge variant={getMemberStatusVariant(membership)}>
                {getMemberStatus(membership)}
              </Badge>
            </MemberField>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemberTable({ members }: { members: MemberRecord[] }) {
  return (
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
              <TableCell className="max-w-64 break-all">{getMemberEmail(membership)}</TableCell>
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
  );
}

function MembersError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      aria-label="We could not load team members"
      className="grid gap-3 rounded-md border border-semantic-critical/30 bg-semantic-critical-muted p-4 text-center"
    >
      <p className="text-sm text-semantic-critical-muted-foreground">{message}</p>
      <div>
        <Button onClick={onRetry} className="min-h-11 w-full sm:w-auto">
          Try again
        </Button>
      </div>
    </div>
  );
}

interface MembersBodyProps {
  members: MemberRecord[];
  isFetching: boolean;
  error: string | null;
  onRetry: () => void;
}

function MembersBody({ members, isFetching, error, onRetry }: MembersBodyProps) {
  if (isFetching) {
    return <StatusMessage label="Loading team members">Loading team members...</StatusMessage>;
  }
  if (error) {
    return <MembersError message={error} onRetry={onRetry} />;
  }
  if (members.length === 0) {
    return (
      <StatusMessage label="No team members found">
        No team members found in this organization. Use Settings to invite the first team member.
      </StatusMessage>
    );
  }
  return (
    <>
      <MemberSummaryList members={members} />
      <MemberTable members={members} />
    </>
  );
}

export function UserManagementPage() {
  const { organization, isLoaded } = useOrganization();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [isFetchingMembers, setIsFetchingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      latestRequestIdRef.current += 1;
    };
  }, []);

  const fetchMembers = useCallback(async () => {
    if (!organization) return;

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const canUpdate = () => isMountedRef.current && latestRequestIdRef.current === requestId;

    setIsFetchingMembers(true);
    setMembersError(null);
    try {
      const result = await organization.getMemberships({ pageSize: 50 });
      if (!canUpdate()) return;
      setMembers(result.data as MemberRecord[]);
    } catch {
      if (!canUpdate()) return;
      setMembers([]);
      setMembersError('We could not load team members. Check the connection and try again.');
    } finally {
      if (canUpdate()) {
        setIsFetchingMembers(false);
      }
    }
  }, [organization]);

  useEffect(() => {
    if (!organization) {
      latestRequestIdRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resets member state when the organization becomes absent
      setMembers([]);
      setMembersError(null);
      setIsFetchingMembers(false);
      return undefined;
    }

    fetchMembers();

    return () => {
      latestRequestIdRef.current += 1;
    };
  }, [organization, fetchMembers]);

  const handleRetryMembers = useCallback(() => {
    fetchMembers();
  }, [fetchMembers]);

  return (
    <section className="mx-auto w-full max-w-5xl" aria-labelledby="team-members-heading">
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
            <StatusMessage label="Loading organization">Loading organization...</StatusMessage>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="px-4 sm:px-6">
            <CardTitle role="heading" aria-level={2} className="text-lg font-semibold">
              Organization members
            </CardTitle>
            <CardDescription className="max-w-3xl">
              Members in {organization.name}. To invite new team members, use the Settings tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            <MembersBody
              members={members}
              isFetching={isFetchingMembers}
              error={membersError}
              onRetry={handleRetryMembers}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
