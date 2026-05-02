import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { UserManagementPage } from '../pages/UserManagementPage';
import { useOrganization } from '@clerk/clerk-react';

// Mock Clerk hooks
const mockGetMemberships = jest.fn();
jest.mock('@clerk/clerk-react', () => ({
  useOrganization: jest.fn(),
}));

// Mock UI components
jest.mock('../components/ui/card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: any) => <div data-testid="card-title">{children}</div>,
  CardDescription: ({ children }: any) => <div data-testid="card-description">{children}</div>,
  CardContent: ({ children }: any) => <div data-testid="card-content">{children}</div>,
}));

describe('UserManagementPage', () => {
  const mockToken = 'mock-token';

  beforeEach(() => {
    jest.clearAllMocks();
    (useOrganization as jest.Mock).mockReturnValue({
      organization: {
        id: 'org_123',
        name: 'Test Org',
        getMemberships: mockGetMemberships,
      },
      isLoaded: true,
    });
  });

  test('renders organization members table', async () => {
    mockGetMemberships.mockResolvedValue({
      data: [
        {
          id: 'mem_1',
          role: 'admin',
          createdAt: new Date('2026-01-01'),
          publicUserData: {
            firstName: 'John',
            lastName: 'Doe',
            identifier: 'john@example.com',
          },
        },
        {
          id: 'mem_2',
          role: 'member',
          createdAt: null, // Pending
          publicUserData: {
            firstName: 'Jane',
            lastName: 'Smith',
            identifier: 'jane@example.com',
          },
        },
      ],
    });

    render(<UserManagementPage token={mockToken} />);

    expect(screen.getByText('Team Members')).toBeInTheDocument();
    expect(screen.getByText(/Members in Test Org/i)).toBeInTheDocument();

    // Wait for members to load
    await waitFor(() => {
      expect(screen.queryByText('Loading members...')).not.toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    
    // Header + 2 data rows
    expect(rows).toHaveLength(3);

    expect(within(rows[1]).getByText('John Doe')).toBeInTheDocument();
    expect(within(rows[1]).getByText('john@example.com')).toBeInTheDocument();
    expect(within(rows[1]).getByText('admin')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Active')).toBeInTheDocument();

    expect(within(rows[2]).getByText('Jane Smith')).toBeInTheDocument();
    expect(within(rows[2]).getByText('jane@example.com')).toBeInTheDocument();
    expect(within(rows[2]).getByText('member')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Pending')).toBeInTheDocument();

    expect(mockGetMemberships).toHaveBeenCalledWith({ limit: 50 });
  });

  test('shows loading state when organization is not loaded', () => {
    (useOrganization as jest.Mock).mockReturnValue({
      organization: null,
      isLoaded: false,
    });

    render(<UserManagementPage token={mockToken} />);
    expect(screen.getByText('Loading organization...')).toBeInTheDocument();
  });

  test('shows empty state when no members found', async () => {
    mockGetMemberships.mockResolvedValue({ data: [] });

    render(<UserManagementPage token={mockToken} />);

    await waitFor(() => {
      expect(screen.getByText('No members found in this organization.')).toBeInTheDocument();
    });
  });
});
