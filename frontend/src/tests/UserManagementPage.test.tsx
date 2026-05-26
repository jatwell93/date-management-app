import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UserManagementPage } from '../pages/UserManagementPage';
import { useOrganization } from '@clerk/clerk-react';

// Mock Clerk hooks
const mockGetMemberships = jest.fn();
jest.mock('@clerk/clerk-react', () => ({
  useOrganization: jest.fn(),
}));

// Mock UI components
type MockCardProps = React.PropsWithChildren<{ className?: string }>;

jest.mock('../components/ui/card', () => ({
  Card: ({ children, className }: MockCardProps) => (
    <div className={className} data-testid="card">
      {children}
    </div>
  ),
  CardHeader: ({ children, className }: MockCardProps) => (
    <div className={className} data-testid="card-header">
      {children}
    </div>
  ),
  CardTitle: ({ children, className }: MockCardProps) => (
    <div className={className} data-testid="card-title">
      {children}
    </div>
  ),
  CardDescription: ({ children, className }: MockCardProps) => (
    <div className={className} data-testid="card-description">
      {children}
    </div>
  ),
  CardContent: ({ children, className }: MockCardProps) => (
    <div className={className} data-testid="card-content">
      {children}
    </div>
  ),
}));

describe('UserManagementPage', () => {
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

    render(<UserManagementPage />);

    expect(screen.getByText('Team members')).toBeInTheDocument();
    expect(screen.getByText(/Members in Test Org/i)).toBeInTheDocument();

    // Wait for members to load
    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: /loading team members/i }),
      ).not.toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');

    // Header + 2 data rows
    expect(rows).toHaveLength(3);

    expect(within(rows[1]).getByText('John Doe')).toBeInTheDocument();
    expect(within(rows[1]).getByText('john@example.com')).toBeInTheDocument();
    expect(within(rows[1]).getByText('admin')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Active')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Active')).toHaveAttribute('data-slot', 'badge');

    expect(within(rows[2]).getByText('Jane Smith')).toBeInTheDocument();
    expect(within(rows[2]).getByText('jane@example.com')).toBeInTheDocument();
    expect(within(rows[2]).getByText('member')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Pending')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Pending')).toHaveAttribute('data-slot', 'badge');

    expect(mockGetMemberships).toHaveBeenCalledWith({ pageSize: 50 });
  });

  test('shows loading state when organization is not loaded', () => {
    (useOrganization as jest.Mock).mockReturnValue({
      organization: null,
      isLoaded: false,
    });

    render(<UserManagementPage />);
    expect(screen.getByRole('status', { name: /loading organization/i })).toBeInTheDocument();
  });

  test('announces member loading state while memberships are pending', () => {
    mockGetMemberships.mockReturnValue(new Promise(() => undefined));

    render(<UserManagementPage />);

    expect(screen.getByRole('status', { name: /loading team members/i })).toBeInTheDocument();
  });

  test('shows empty state when no members found', async () => {
    mockGetMemberships.mockResolvedValue({ data: [] });

    render(<UserManagementPage />);

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /no team members found/i })).toBeInTheDocument();
    });
  });

  test('shows recoverable alert when memberships fail and retries loading', async () => {
    mockGetMemberships
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        data: [
          {
            id: 'mem_1',
            role: 'admin',
            createdAt: new Date('2026-01-01'),
            publicUserData: {
              firstName: 'Mira',
              lastName: 'Patel',
              identifier: 'mira@example.com',
            },
          },
        ],
      });

    render(<UserManagementPage />);

    expect(
      await screen.findByRole('alert', {
        name: /we could not load team members/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Mira Patel').length).toBeGreaterThan(0);
    });
    expect(mockGetMemberships).toHaveBeenCalledTimes(2);
  });

  test('renders mobile member summaries that withstand long member details', async () => {
    const longName = 'Alexandria-Mae Verylongpharmacymanagername With Multiple Compound Surnames';
    const longEmail =
      'alexandria.verylongpharmacymanagername.with.compound.surnames@example-pharmacy-domain.com.au';

    mockGetMemberships.mockResolvedValue({
      data: [
        {
          id: 'mem_long',
          role: 'org:admin:regional-operations-manager-with-extra-context',
          createdAt: null,
          publicUserData: {
            firstName: longName,
            lastName: '',
            identifier: longEmail,
          },
        },
      ],
    });

    render(<UserManagementPage />);

    const summaries = await screen.findByRole('list', { name: /team member summaries/i });
    const summary = within(summaries).getByRole('listitem', { name: new RegExp(longName) });

    expect(within(summary).getByText(longName)).toHaveClass('break-words');
    expect(within(summary).getByText(longEmail)).toHaveClass('break-all');
    expect(within(summary).getByText(/regional-operations-manager/i)).toHaveClass('break-words');
    expect(within(summary).getByText('Pending')).toBeInTheDocument();
  });

  test('keeps responsive layout usable through phone and small tablet widths', async () => {
    mockGetMemberships.mockResolvedValue({
      data: [
        {
          id: 'mem_1',
          role: 'admin',
          createdAt: new Date('2026-01-01'),
          publicUserData: {
            firstName: 'Mira',
            lastName: 'Patel',
            identifier: 'mira@example.com',
          },
        },
      ],
    });

    render(<UserManagementPage />);

    const page = screen.getByRole('main', { name: /team members/i });
    expect(page).toHaveClass('px-3', 'sm:px-4', 'lg:px-6');

    const summaries = await screen.findByRole('list', { name: /team member summaries/i });
    expect(summaries).toHaveClass('md:hidden');
    expect(summaries).not.toHaveClass('sm:hidden');

    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('data-slot', 'table');
    expect(table).toHaveAccessibleName('Organization member details');
  });

  test('uses full-width retry action on narrow screens', async () => {
    mockGetMemberships.mockRejectedValue(new Error('Network unavailable'));

    render(<UserManagementPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toHaveClass('min-h-11', 'w-full');
  });
});
