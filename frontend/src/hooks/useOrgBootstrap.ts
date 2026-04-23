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
 * Hook that calls POST /api/organization/bootstrap after Clerk auth is established.
 * Works with or without Clerk organization context:
 * - If user is in a Clerk org, uses that org ID
 * - If user has no Clerk org, backend creates a default organization
 * - Idempotent — safe to re-run on every mount.
 *
 * Returns the bootstrap state so the UI can render loading/error/success.
 */
export function useOrgBootstrap(): UseOrgBootstrapReturn {
  const { getToken, isLoaded: isAuthLoaded, userId } = useAuth();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);
  const attemptedRef = useRef(false);

  const doBootstrap = useCallback(async () => {
    // Wait for auth and org context to finish loading.
    // If organization is still null after load, backend creates a default org.
    if (!isAuthLoaded || !isOrgLoaded || !userId) return;

    setIsBootstrapping(true);
    setBootstrapError(null);

    try {
      const token = await getToken();
      if (!token) {
        setBootstrapError('No auth token available');
        return;
      }

      // If user is in a Clerk organization, use that
      // Otherwise, backend will create a default organization
      const bootstrapPayload = {
        ...(organization && {
          clerkOrganizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug ?? organization.id,
        }),
      };

      const result = await apiService.post<BootstrapResult>(
        '/api/organization/bootstrap',
        bootstrapPayload,
        token,
      );

      setBootstrapResult(result);
      setIsBootstrapped(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bootstrap failed';
      setBootstrapError(message);
      console.error('[useOrgBootstrap] Bootstrap error:', message, { error });
    } finally {
      setIsBootstrapping(false);
    }
  }, [getToken, userId, isAuthLoaded, isOrgLoaded, organization]);

  useEffect(() => {
    // Trigger bootstrap only after Clerk org loading completes.
    // This avoids invited users falling into the default-org path prematurely.
    if (!isAuthLoaded || !isOrgLoaded || !userId || attemptedRef.current) return;

    attemptedRef.current = true;
    void doBootstrap();
  }, [isAuthLoaded, isOrgLoaded, userId, doBootstrap]);

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
