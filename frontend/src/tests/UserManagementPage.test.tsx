import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { UserManagementPage } from '../pages/UserManagementPage';
import { apiService } from '../lib/api.service';

// Mock UI components
jest.mock('../components/ui/select', () => ({
  Select: ({ onValueChange, children, defaultValue }: any) => (
    <select
      data-testid="select"
      defaultValue={defaultValue}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => (
    <option value="" disabled>
      Select...
    </option>
  ),
  SelectValue: ({ placeholder }: any) => <>{placeholder}</>,
  SelectContent: ({ children }: any) => <optgroup label="Options">{children}</optgroup>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('UserManagementPage', () => {
  const mockToken = 'mock-manager-token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders user management page and fetches users', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, role: 'admin' },
      { id: 2, role: 'team_member' },
    ]);

    render(<UserManagementPage token={mockToken} />);

    expect(screen.getByText(/User Management \(Managers Only\)/i)).toBeInTheDocument();

    // Wait for list to appear
    const list = await screen.findByRole('list');
    expect(within(list).getByText(/ID: 1, Role: Admin/i)).toBeInTheDocument();
    expect(within(list).getByText(/ID: 2, Role: Team Member/i)).toBeInTheDocument();

    expect(apiService.get).toHaveBeenCalledTimes(1);
    expect(apiService.get).toHaveBeenCalledWith('/users', mockToken);
  });

  test('creates a new user', async () => {
    (apiService.get as jest.Mock)
      .mockResolvedValueOnce([
        { id: 1, role: 'admin' },
        { id: 2, role: 'team_member' },
      ])
      .mockResolvedValueOnce([
        // After create
        { id: 1, role: 'admin' },
        { id: 2, role: 'team_member' },
        { id: 3, role: 'team_member' },
      ]);

    (apiService.post as jest.Mock).mockResolvedValue({ message: 'User created successfully!' });

    render(<UserManagementPage token={mockToken} />);

    // Wait for validation of load
    const list = await screen.findByRole('list');

    // Fill Form
    fireEvent.change(screen.getByPlaceholderText(/Enter user PIN/i), {
      target: { value: '5678' },
    });

    // Select Role in Create Form (First Select)
    const createRoleSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(createRoleSelect, { target: { value: 'team_member' } });

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

    // Expect at least one success message
    await waitFor(() => {
      expect(screen.getAllByText(/User created successfully!/i).length).toBeGreaterThan(0);
    });

    // Check if new user is in the list
    expect(await within(list).findByText(/ID: 3, Role: Team Member/i)).toBeInTheDocument();

    expect(apiService.post).toHaveBeenCalledWith(
      '/users',
      { pin: '5678', role: 'team_member' },
      mockToken,
    );
  });

  test('updates an existing user role', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, role: 'admin' },
      { id: 2, role: 'team_member' },
    ]);
    (apiService.put as jest.Mock).mockResolvedValue({ message: 'User updated successfully!' });

    render(<UserManagementPage token={mockToken} />);

    await screen.findByRole('list');

    // Edit User Form: Select User (Index 1), Select Role (Index 2)
    const selects = await screen.findAllByRole('combobox');
    const editUserSelect = selects[1];

    fireEvent.change(editUserSelect, { target: { value: '2' } });

    const editRoleSelect = selects[2];
    fireEvent.change(editRoleSelect, { target: { value: 'admin' } });

    fireEvent.click(screen.getByRole('button', { name: /Update User/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/User updated successfully!/i).length).toBeGreaterThan(0);
    });

    expect(apiService.put).toHaveBeenCalledWith('/users/2', { role: 'admin' }, mockToken);
  });

  test('deletes a user', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, role: 'admin' },
      { id: 2, role: 'team_member' },
    ]);
    (apiService.delete as jest.Mock).mockResolvedValue({ message: 'User deleted successfully!' });

    render(<UserManagementPage token={mockToken} />);

    await screen.findByRole('list');

    // Delete User Form: Select User (Index 3)
    const selects = await screen.findAllByRole('combobox');
    const deleteUserSelect = selects[3];

    fireEvent.change(deleteUserSelect, { target: { value: '2' } });

    // Mock confirm
    window.confirm = jest.fn(() => true);

    fireEvent.click(screen.getByRole('button', { name: /Delete User/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/User deleted successfully!/i).length).toBeGreaterThan(0);
    });

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(apiService.delete).toHaveBeenCalledWith('/users/2', mockToken);
  });
});
