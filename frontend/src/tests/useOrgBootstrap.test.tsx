import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useAuth, useOrganization } from '@clerk/clerk-react';
import { apiService } from '../lib/api.service';
import { useOrgBootstrap } from '../hooks/useOrgBootstrap';

jest.mock('@clerk/clerk-react', () => ({
    useAuth: jest.fn(),
    useOrganization: jest.fn(),
}));

jest.mock('../lib/api.service', () => ({
    apiService: {
        post: jest.fn(),
    },
}));

function Probe() {
    useOrgBootstrap();
    return null;
}

describe('useOrgBootstrap', () => {
    const mockUseAuth = useAuth as jest.Mock;
    const mockUseOrganization = useOrganization as jest.Mock;
    const mockPost = apiService.post as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockPost.mockResolvedValue({
            userId: 1,
            organizationId: 'org-1',
            role: 'admin',
            isNewOrg: false,
            isNewUser: false,
            isFirstAdmin: false,
        });
    });

    it('waits for organization loading to complete before bootstrapping invited users', async () => {
        const getToken = jest.fn().mockResolvedValue('clerk-token');

        mockUseAuth.mockReturnValue({
            getToken,
            isLoaded: true,
            userId: 'user_123',
        });

        const orgState = {
            organization: {
                id: 'org_123',
                name: 'Acme Pharmacy',
                slug: 'acme-pharmacy',
            },
            isLoaded: false,
        };

        mockUseOrganization.mockImplementation(() => orgState);

        const { rerender } = render(<Probe />);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mockPost).not.toHaveBeenCalled();

        orgState.isLoaded = true;
        rerender(<Probe />);

        await waitFor(() => {
            expect(mockPost).toHaveBeenCalledTimes(1);
        });

        expect(mockPost).toHaveBeenCalledWith(
            '/api/organization/bootstrap',
            {
                clerkOrganizationId: 'org_123',
                organizationName: 'Acme Pharmacy',
                organizationSlug: 'acme-pharmacy',
            },
            'clerk-token',
        );
    });

    it('bootstraps with default-org payload when no Clerk organization exists after load', async () => {
        const getToken = jest.fn().mockResolvedValue('clerk-token');

        mockUseAuth.mockReturnValue({
            getToken,
            isLoaded: true,
            userId: 'user_456',
        });

        mockUseOrganization.mockReturnValue({
            organization: null,
            isLoaded: true,
        });

        render(<Probe />);

        await waitFor(() => {
            expect(mockPost).toHaveBeenCalledTimes(1);
        });

        expect(mockPost).toHaveBeenCalledWith('/api/organization/bootstrap', {}, 'clerk-token');
    });
});
