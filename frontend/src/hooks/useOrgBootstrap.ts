import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, useOrganization } from '@clerk/clerk-react';
import { apiService } from '../lib/api.service';
import { RoleValue } from '../constants/roles';

interface BootstrapResult {
  userId: number;
  organizationId: string;
  role: RoleValue;
  isNewOrg: boolean;
  isNewUser: boolean;
  isFirstAdmin: boolean;
}

interface UseOrgBootstrapReturn {
  isBootstrapped: boolean;
  isBootstrapping: boolean;
  bootstrapError: string | null;
  bootstrapResult: BootstrapResult | null;
  retry: () => void;
}

/**
 * Hook that calls POST /api/organization/bootstrap after Clerk auth + org
 * context is established. Idempotent — safe to re-run on every mount.
 *
 * Returns the bootstrap state so the UI can render loading/error/success.
 */
export function useOrgBootstrap(): UseOrgBootstrapReturn {
  const { getToken } = useAuth();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);
  const attemptedRef = useRef(false);

  const doBootstrap = useCallback(async () => {
    if (!organization || !isOrgLoaded) return;

    setIsBootstrapping(true);
    setBootstrapError(null);

    try {
      const token = await getToken();
      if (!token) {
        setBootstrapError('No auth token available');
        return;
      }

      const result = await apiService.post<BootstrapResult>(
        '/api/organization/bootstrap',
        {
          clerkOrganizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug ?? organization.id,
        },
        token,
      );

      setBootstrapResult(result);
      setIsBootstrapped(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bootstrap failed';
      setBootstrapError(message);
    } finally {
      setIsBootstrapping(false);
    }
  }, [getToken, organization, isOrgLoaded]);

  useEffect(() => {
    if (!isOrgLoaded || !organization || attemptedRef.current) return;

    attemptedRef.current = true;
    void doBootstrap();
  }, [isOrgLoaded, organization, doBootstrap]);

  const retry = useCallback(() => {
    attemptedRef.current = false;
    void doBootstrap();
  }, [doBootstrap]);

  return {
    isBootstrapped,
    isBootstrapping,
    bootstrapError,
    bootstrapResult,
    retry,
  };
}
