import React from 'react';
import { randomUUID } from 'crypto';
import { render, screen, fireEvent, waitFor as _waitFor } from '@testing-library/react';
import { StoreAreaManagementPage } from '../pages/StoreAreaManagementPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

const testSessionToken = randomUUID();

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('StoreAreaManagementPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the store area management page and fetches areas', async () => {
    // Mock successful GET
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: '2025-09-20T10:00:00Z' },
      { id: 2, name: 'Aisle 2', last_checked: null },
    ]);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    expect(screen.getByText(/Store Area Management/i)).toBeInTheDocument();

    expect(await screen.findByText(/Aisle 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Aisle 2/i)).toBeInTheDocument();
    expect(apiService.get).toHaveBeenCalledWith('/store-areas', testSessionToken);
  });

  it('adds a new store area', async () => {
    // Initial fetch returns empty or existing
    (apiService.get as jest.Mock).mockResolvedValueOnce([
        { id: 1, name: 'Aisle 1', last_checked: null } 
    ]).mockResolvedValueOnce([ // After add
        { id: 1, name: 'Aisle 1', last_checked: null },
        { id: 3, name: 'New Area', last_checked: null }
    ]);

    (apiService.post as jest.Mock).mockResolvedValue({ id: 3, name: 'New Area', last_checked: null });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findByText(/Aisle 1/i);

    fireEvent.change(screen.getByPlaceholderText(/Area Name/i), {
      target: { value: 'New Area' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Area/i }));

    // Verify POST call
    await _waitFor(() => expect(apiService.post).toHaveBeenCalledWith(
      '/store-areas',
      { name: 'New Area', subDepartment: '' },
      testSessionToken
    ));

    // Verify success message and subsequent operations (Mock update)
     expect(await screen.findByText(/Store area added successfully!/i)).toBeInTheDocument();
  });

  it('edits an existing store area', async () => {
     (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: null }
    ]);
    (apiService.put as jest.Mock).mockResolvedValue({ message: 'Store area updated successfully!' });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findByText(/Aisle 1/i);

    // Open Edit Dialog
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/i })[0]); 
    
    // In Dialog
    const editInput = screen.getByLabelText(/Name/i); // Matches Label htmlFor="editedAreaName"
    fireEvent.change(editInput, { target: { value: 'Updated Aisle 1' } });

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await _waitFor(() => expect(apiService.put).toHaveBeenCalledWith(
      '/store-areas/1',
      { name: 'Updated Aisle 1', subDepartment: '' },
      testSessionToken
    ));
    
    expect(await screen.findByText(/Store area updated successfully!/i)).toBeInTheDocument();
  });

  it('deletes a store area', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: null }
    ]);
    (apiService.delete as jest.Mock).mockResolvedValue({ message: 'Store area deleted successfully!' });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findByText(/Aisle 1/i);

    // Mock confirm
    window.confirm = jest.fn(() => true);

    fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]); 

    await _waitFor(() => expect(apiService.delete).toHaveBeenCalledWith('/store-areas/1', testSessionToken));
    
    expect(await screen.findByText(/Store area deleted successfully!/i)).toBeInTheDocument();
  });
});
