import React from 'react';
import { randomUUID } from 'crypto';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor as _waitFor,
  within,
} from '@testing-library/react';
import { StoreAreaManagementPage } from '../pages/StoreAreaManagementPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

const testSessionToken = randomUUID();
const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

// Mock apiService
vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('StoreAreaManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue(undefined);
  });

  it('renders the store area management page and fetches areas', async () => {
    // Mock successful GET
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: '2025-09-20T10:00:00Z' },
      { id: 2, name: 'Aisle 2', last_checked: null },
    ]);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    expect(screen.getByText(/Store Area Management/i)).toBeInTheDocument();

    expect((await screen.findAllByText(/Aisle 1/i)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Aisle 2/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/20 Sept 2025/i)).toHaveLength(2);
    expect(apiService.get).toHaveBeenCalledWith(
      '/store-areas',
      testSessionToken,
      expect.any(AbortSignal),
    );
  });

  it('labels add fields and announces validation errors', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([]);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    // Let the initial fetchStoreAreas() promise settle before interacting. On
    // success it calls setError(null), which would otherwise clear the
    // validation error asserted below (a timing race that jest happened to win
    // by settling the fetch before the click).
    await act(async () => {});

    expect(screen.getByLabelText(/Area name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sub-department/i)).toHaveAttribute('maxLength', '50');

    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    expect(await screen.findByText(/store area name cannot be empty/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Area name$/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses specific copy for add, save, and delete flows', async () => {
    (apiService.get as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, name: 'Aisle 1', last_checked: null }])
      .mockResolvedValue([{ id: 1, name: 'Aisle 1', last_checked: null }]);
    (apiService.post as jest.Mock).mockResolvedValue({
      id: 2,
      name: 'Dispensary Shelf',
      last_checked: null,
    });
    (apiService.put as jest.Mock).mockResolvedValue({ message: 'Updated' });
    (apiService.delete as jest.Mock).mockResolvedValue({ message: 'Deleted' });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Aisle 1/i);

    expect(screen.getByRole('heading', { name: /Add expiry-check location/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add location/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Area name/i), {
      target: { value: 'Dispensary Shelf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Dispensary Shelf added/i);

    fireEvent.click(screen.getAllByRole('button', { name: /Edit/i })[0]);
    expect(screen.getByRole('heading', { name: /Edit Aisle 1/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Update this location name or sub-department for expiry checks/i),
    ).toBeInTheDocument();
    const clarifyDialog = screen.getByRole('dialog');
    fireEvent.change(within(clarifyDialog).getByLabelText(/^Area name$/i), {
      target: { value: 'Front Counter' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save location/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Front Counter updated/i);

    fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

    const deleteDialog = screen.getByRole('alertdialog');
    expect(
      within(deleteDialog).getByRole('heading', { name: /Delete Aisle 1/i }),
    ).toBeInTheDocument();
    expect(
      within(deleteDialog).getByText(/This removes the location from future expiry checks/i),
    ).toBeInTheDocument();
    fireEvent.click(within(deleteDialog).getByRole('button', { name: /Delete location/i }));

    await _waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Aisle 1 deleted/i));
  });

  it('renders mobile store area rows with labelled values and touch-sized actions', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      {
        id: 14,
        name: 'Long Dispensary Overflow Shelf',
        subDepartment: 'Cold chain returns',
        last_checked: null,
      },
    ]);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    const mobileList = await screen.findByRole('list', {
      name: /^store areas$/i,
    });
    const mobileRow = within(mobileList).getByRole('listitem', {
      name: /Long Dispensary Overflow Shelf/i,
    });

    expect(within(mobileRow).getByText('Area')).toBeInTheDocument();
    expect(within(mobileRow).getByText('Sub-department')).toBeInTheDocument();
    expect(within(mobileRow).getByText('Last checked')).toBeInTheDocument();
    expect(within(mobileRow).getByText('Not checked')).toBeInTheDocument();
    expect(
      within(mobileRow).getByRole('button', { name: /Edit Long Dispensary Overflow Shelf/i }),
    ).toHaveClass('min-h-11');
    expect(
      within(mobileRow).getByRole('button', { name: /Delete Long Dispensary Overflow Shelf/i }),
    ).toHaveClass('min-h-11');
  });

  it('adds a new store area', async () => {
    // Initial fetch returns empty or existing
    (apiService.get as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, name: 'Aisle 1', last_checked: null }])
      .mockResolvedValueOnce([
        // After add
        { id: 1, name: 'Aisle 1', last_checked: null },
        { id: 3, name: 'New Area', last_checked: null },
      ]);

    (apiService.post as jest.Mock).mockResolvedValue({
      id: 3,
      name: 'New Area',
      last_checked: null,
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Aisle 1/i);

    fireEvent.change(screen.getByLabelText(/Area name/i), {
      target: { value: 'New Area' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    // Verify POST call
    await _waitFor(() =>
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas',
        { name: 'New Area', subDepartment: '' },
        testSessionToken,
      ),
    );

    // Verify success message and subsequent operations (Mock update)
    expect(await screen.findByRole('status')).toHaveTextContent(/New Area added/i);
  });

  it('assigns a new bay to a parent department', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 10, name: 'Hair', parentId: null, last_checked: null },
      { id: 11, name: 'Hair Bay 1', parentId: 10, last_checked: null },
    ]);
    (apiService.post as jest.Mock).mockResolvedValue({
      id: 12,
      name: 'Hair Bay 2',
      parentId: 10,
      last_checked: null,
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Hair Bay 1/i);

    fireEvent.change(screen.getByLabelText(/Area name/i), {
      target: { value: 'Hair Bay 2' },
    });
    fireEvent.change(screen.getByLabelText(/Parent department/i), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    await _waitFor(() =>
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas',
        { name: 'Hair Bay 2', subDepartment: '', parentId: 10 },
        testSessionToken,
      ),
    );
  });

  it('renders active floor progress and records a bay check', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/store-areas') {
        return Promise.resolve([
          { id: 10, name: 'Hair', parentId: null, last_checked: null },
          { id: 11, name: 'Hair Bay 1', parentId: 10, last_checked: '2026-07-08T08:00:00Z' },
          { id: 12, name: 'Hair Bay 2', parentId: 10, last_checked: null },
        ]);
      }
      if (url === '/store-areas/floor-progress') {
        return Promise.resolve({
          activeCycle: { id: 31, name: 'July walk', status: 'active' },
          summary: {
            totalBays: 2,
            checkedBays: 1,
            notCheckedBays: 1,
            overdueBays: 0,
            uncheckedBays: 1,
            coveragePercent: 50,
          },
          departments: [
            {
              department: { id: 10, name: 'Hair' },
              summary: {
                totalBays: 2,
                checkedBays: 1,
                notCheckedBays: 1,
                overdueBays: 0,
                uncheckedBays: 1,
                coveragePercent: 50,
              },
              bays: [
                {
                  id: 11,
                  name: 'Hair Bay 1',
                  parentId: 10,
                  state: 'checked',
                  checkedAt: '2026-07-10T01:00:00.000Z',
                  checkedBy: { id: 7, name: 'Alex Checker' },
                },
                {
                  id: 12,
                  name: 'Hair Bay 2',
                  parentId: 10,
                  state: 'not_checked',
                  checkedAt: null,
                  checkedBy: null,
                },
              ],
            },
          ],
        });
      }
      return Promise.resolve([]);
    });
    (apiService.post as jest.Mock).mockResolvedValue({
      id: 41,
      storeAreaId: 12,
      itemsAddedCount: 0,
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    expect(await screen.findByRole('heading', { name: /Floor Progress/i })).toBeInTheDocument();
    expect(screen.getByText(/July walk/i)).toBeInTheDocument();
    expect(screen.getAllByText(/50%/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Alex Checker/i)).toBeInTheDocument();
    expect(screen.getByText(/Not yet checked/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mark Hair Bay 2 checked/i }));

    await _waitFor(() =>
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas/bay-checks',
        { storeAreaId: 12, itemsAddedCount: 0 },
        testSessionToken,
      ),
    );
    await _waitFor(() =>
      expect(apiService.get).toHaveBeenCalledWith(
        '/store-areas/floor-progress',
        testSessionToken,
        expect.any(AbortSignal),
      ),
    );
  });

  it('starts and completes store walk cycles', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve([]);
      if (url === '/store-areas/floor-progress') {
        return Promise.resolve({
          activeCycle: null,
          summary: {
            totalBays: 0,
            checkedBays: 0,
            notCheckedBays: 0,
            overdueBays: 0,
            uncheckedBays: 0,
            coveragePercent: 0,
          },
          departments: [],
        });
      }
      return Promise.resolve([]);
    });
    (apiService.post as jest.Mock).mockResolvedValue({ id: 31, name: 'July walk' });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    fireEvent.change(await screen.findByLabelText(/Walk name/i), {
      target: { value: 'July walk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start walk/i }));

    await _waitFor(() =>
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas/check-cycles',
        { name: 'July walk' },
        testSessionToken,
      ),
    );

    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve([]);
      if (url === '/store-areas/floor-progress') {
        return Promise.resolve({
          activeCycle: { id: 31, name: 'July walk', status: 'active' },
          summary: {
            totalBays: 0,
            checkedBays: 0,
            notCheckedBays: 0,
            overdueBays: 0,
            uncheckedBays: 0,
            coveragePercent: 0,
          },
          departments: [],
        });
      }
      return Promise.resolve([]);
    });

    expect(await screen.findByRole('button', { name: /Complete walk/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Complete walk/i }));

    await _waitFor(() =>
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas/check-cycles/31/complete',
        {},
        testSessionToken,
      ),
    );
  });

  it('refreshes the Clerk token before creating a store area', async () => {
    mockGetToken.mockResolvedValue('fresh-clerk-token');
    (apiService.get as jest.Mock).mockResolvedValue([]);
    (apiService.post as jest.Mock).mockResolvedValue({
      id: 3,
      name: 'New Area',
      last_checked: null,
    });

    render(<StoreAreaManagementPage token="expired-prop-token" />);

    fireEvent.change(await screen.findByLabelText(/Area name/i), {
      target: { value: 'New Area' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    await _waitFor(() => {
      expect(mockGetToken).toHaveBeenCalled();
      expect(apiService.post).toHaveBeenCalledWith(
        '/store-areas',
        { name: 'New Area', subDepartment: '' },
        'fresh-clerk-token',
      );
    });
  });

  it('prevents duplicate add submissions while saving', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([]);
    let resolvePost: (value: unknown) => void = () => {};
    (apiService.post as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    render(<StoreAreaManagementPage token={testSessionToken} />);

    fireEvent.change(await screen.findByLabelText(/Area name/i), {
      target: { value: 'New Area' },
    });

    const addButton = screen.getByRole('button', { name: /Add location/i });
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    await _waitFor(() => expect(apiService.post).toHaveBeenCalledTimes(1));
    expect(addButton).toBeDisabled();

    await act(async () => {
      resolvePost({ id: 3, name: 'New Area', lastChecked: null });
    });
  });

  it('edits an existing store area', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: null },
    ]);
    (apiService.put as jest.Mock).mockResolvedValue({
      message: 'Store area updated successfully!',
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Aisle 1/i);

    // Open Edit Dialog
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/i })[0]);

    // In Dialog
    const editDialog = screen.getByRole('dialog');
    const editInput = within(editDialog).getByLabelText(/^Area name$/i);
    expect(within(editDialog).getByLabelText(/^Sub-department$/i)).toHaveAttribute(
      'maxLength',
      '50',
    );
    fireEvent.change(editInput, { target: { value: 'Updated Aisle 1' } });

    fireEvent.click(screen.getByRole('button', { name: /Save location/i }));

    await _waitFor(() =>
      expect(apiService.put).toHaveBeenCalledWith(
        '/store-areas/1',
        { name: 'Updated Aisle 1', subDepartment: '' },
        testSessionToken,
      ),
    );

    expect(await screen.findByText(/Updated Aisle 1 updated/i)).toBeInTheDocument();
  });

  it('marks the edit area name invalid without marking the add field invalid', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: null },
    ]);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole('button', { name: /Edit Aisle 1/i })[0]);

    const editDialog = screen.getByRole('dialog');
    fireEvent.change(within(editDialog).getByLabelText(/^Area name$/i), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save location/i }));

    expect(await screen.findByText(/store area name cannot be empty/i)).toBeInTheDocument();
    expect(within(editDialog).getByLabelText(/^Area name$/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getAllByLabelText(/^Area name$/i)[0]).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('confirms before deleting a store area', async () => {
    (apiService.get as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Aisle 1', last_checked: null },
    ]);
    (apiService.delete as jest.Mock).mockResolvedValue({
      message: 'Store area deleted successfully!',
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);

    await screen.findAllByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

    const deleteDialog = screen.getByRole('alertdialog');
    fireEvent.click(within(deleteDialog).getByRole('button', { name: /Cancel/i }));

    expect(apiService.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /Delete location/i }),
    );

    await _waitFor(() =>
      expect(apiService.delete).toHaveBeenCalledWith('/store-areas/1', testSessionToken),
    );

    expect(await screen.findByText(/Aisle 1 deleted/i)).toBeInTheDocument();
  });
});

const progressSummary = (coveragePercent: number) => ({
  totalBays: 2,
  checkedBays: 1,
  notCheckedBays: 0,
  overdueBays: 1,
  uncheckedBays: 1,
  coveragePercent,
});

function mockAreasAndProgress(areas: unknown[], progress: unknown = null) {
  // @ts-expect-error — apiService.get is mocked as vi.fn()
  apiService.get.mockImplementation((url: string) =>
    Promise.resolve(url === '/store-areas/floor-progress' ? progress : areas),
  );
}

const activeProgress = {
  activeCycle: { id: 31, name: 'July walk', status: 'active' },
  summary: progressSummary(50),
  departments: [
    {
      department: { id: 10, name: 'Hair' },
      summary: progressSummary(50),
      bays: [
        {
          id: 11,
          name: 'Hair Bay 1',
          parentId: 10,
          state: 'checked',
          checkedAt: null,
          checkedBy: null,
        },
        {
          id: 12,
          name: 'Hair Bay 2',
          parentId: 10,
          state: 'overdue',
          checkedAt: null,
          checkedBy: null,
        },
      ],
    },
  ],
};

describe('StoreAreaManagementPage UI audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue(undefined);
  });

  it('uses AA-contrast tokens for messages and a calm row delete trigger', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }]);
    (apiService.post as jest.Mock).mockResolvedValue({ id: 2, name: 'Shelf', last_checked: null });

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    const [deleteTrigger] = screen.getAllByRole('button', { name: 'Delete Aisle 1' });
    expect(deleteTrigger).toHaveClass('text-semantic-critical-muted-foreground');
    expect(deleteTrigger).not.toHaveClass('bg-semantic-critical');

    fireEvent.change(screen.getByLabelText(/^Area name$/i), { target: { value: 'Shelf' } });
    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    expect(await screen.findByRole('status')).toHaveClass('text-semantic-success-muted-foreground');
  });

  it('emphasises overdue bays with text, not colour alone', async () => {
    mockAreasAndProgress([], activeProgress);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    const overdue = await screen.findByText('Overdue');
    expect(overdue).toHaveClass('text-semantic-warning-muted-foreground');
  });

  it('sizes every form control and dialog button for touch', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }], {
      ...activeProgress,
      activeCycle: null,
    });

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    [/^Area name$/i, /Sub-department \(optional\)/i, /Parent department/i, /Walk name/i].forEach(
      (label) => expect(screen.getByLabelText(label)).toHaveClass('min-h-11'),
    );
    expect(screen.getByLabelText(/Parent department/i)).toHaveClass('text-base');

    const mobileRow = within(screen.getByRole('list', { name: 'Store areas' })).getByRole(
      'listitem',
      { name: 'Aisle 1' },
    );
    const areaLabel = within(mobileRow).getByText('Area');
    expect(areaLabel.tagName).toBe('DT');
    expect(areaLabel).toHaveClass('text-sm');
    expect(areaLabel).not.toHaveClass('text-xs', 'uppercase');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Aisle 1' })[0]);
    within(screen.getByRole('dialog'))
      .getAllByRole('textbox')
      .forEach((input) => expect(input).toHaveClass('min-h-11'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Aisle 1' })[0]);
    within(screen.getByRole('alertdialog'))
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveClass('min-h-11'));
  });

  it('exposes one page heading with section headings beneath it', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }], activeProgress);

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    expect(screen.getByRole('heading', { level: 1, name: 'Store Area Management' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Floor progress' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Expiry-check locations' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Hair' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Store Area Management' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Store areas' })).toBeInTheDocument();
  });

  it('reports store coverage as a labelled progressbar and names checked bays by state', async () => {
    mockAreasAndProgress([], activeProgress);

    render(<StoreAreaManagementPage token={testSessionToken} />);

    const bar = await screen.findByRole('progressbar', { name: 'Store coverage' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '50% of bays checked');

    const checkedBay = screen.getByRole('button', { name: 'Hair Bay 1 checked' });
    expect(checkedBay).toBeDisabled();
    expect(checkedBay).toHaveTextContent('Checked');
    expect(screen.getByRole('button', { name: 'Mark Hair Bay 2 checked' })).toBeEnabled();

    const bays = within(screen.getByRole('list', { name: 'Hair bays' })).getAllByRole('listitem');
    expect(bays).toHaveLength(2);
    bays.forEach((bay) => expect(bay).not.toHaveClass('border'));
  });

  it('ties the add-name validation error to its field', async () => {
    mockAreasAndProgress([]);

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await act(async () => {});

    const nameInput = screen.getByLabelText(/^Area name$/i);
    expect(nameInput).not.toHaveAttribute('aria-describedby');

    fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

    expect(await screen.findByText('Enter an area name.')).toHaveAttribute(
      'id',
      'newAreaName-error',
    );
    expect(nameInput).toHaveAttribute('aria-describedby', 'newAreaName-error');
    expect(nameInput).toHaveAccessibleDescription('Enter an area name.');
  });

  it('shows edit validation and save errors inside the dialog', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }]);
    (apiService.put as jest.Mock).mockRejectedValue(new Error('Server unavailable'));

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Aisle 1' })[0]);
    const dialog = screen.getByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/^Area name$/i);

    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save location' }));

    expect(await within(dialog).findByText('Enter an area name.')).toBeInTheDocument();
    expect(nameInput).toHaveAccessibleDescription('Enter an area name.');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Front Counter' } });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save location' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(nameInput).toHaveValue('Front Counter');
  });

  it('does not carry an earlier error into a newly opened edit dialog', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }]);
    (apiService.delete as jest.Mock).mockRejectedValue(new Error('Delete failed'));

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Aisle 1' })[0]);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete location' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Aisle 1' })[0]);
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes the edit dialog from Cancel and returns focus to its trigger', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }]);

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    const trigger = screen.getAllByRole('button', { name: 'Edit Aisle 1' })[0];
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await _waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await _waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps the delete trigger focusable while the delete is in flight', async () => {
    mockAreasAndProgress([{ id: 1, name: 'Aisle 1', last_checked: null }]);
    let rejectDelete: (reason: unknown) => void = () => {};
    (apiService.delete as jest.Mock).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );

    render(<StoreAreaManagementPage token={testSessionToken} />);
    await screen.findAllByText(/Aisle 1/i);

    const trigger = screen.getAllByRole('button', { name: 'Delete Aisle 1' })[0];
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete location' }),
    );

    await _waitFor(() => expect(trigger).toHaveTextContent('Deleting'));
    expect(trigger).toBeEnabled();
    await _waitFor(() => expect(apiService.delete).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectDelete(new Error('Delete failed'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
  });
});
