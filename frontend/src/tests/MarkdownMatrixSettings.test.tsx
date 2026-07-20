import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkdownMatrixSettings } from '../components/MarkdownMatrixSettings';
import { apiService } from '../lib/api.service';
import { DEFAULT_MARKDOWN_MATRIX } from '@shared/markdown';
import '@testing-library/jest-dom';

const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const mockedGet = apiService.get as jest.Mock;
const mockedPut = apiService.put as jest.Mock;

describe('MarkdownMatrixSettings', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
    mockGetToken.mockResolvedValue('token');
  });

  it('loads and renders the org matrix with a disabled retail option when no retail data', async () => {
    mockedGet.mockResolvedValue({ matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData: false });

    render(<MarkdownMatrixSettings />);

    await waitFor(() => expect(screen.getByText('Markdown 1')).toBeInTheDocument());

    // Three retail buttons, all disabled because the org has no retail data.
    const retailButtons = screen.getAllByRole('button', { name: /^Retail$/ });
    expect(retailButtons).toHaveLength(3);
    retailButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('enables retail basis when the org has retail data', async () => {
    mockedGet.mockResolvedValue({ matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData: true });

    render(<MarkdownMatrixSettings />);

    await waitFor(() => expect(screen.getByText('Markdown 1')).toBeInTheDocument());

    screen.getAllByRole('button', { name: /^Retail$/ }).forEach((btn) => expect(btn).toBeEnabled());
  });

  it('blocks saving and shows an error when discounts decrease as expiry nears', async () => {
    mockedGet.mockResolvedValue({
      matrix: {
        band1: { percentage: 50, basis: 'cost' },
        band2: { percentage: 60, basis: 'cost' },
        band3: { percentage: 75, basis: 'cost' },
      },
      hasRetailData: false,
    });

    render(<MarkdownMatrixSettings />);
    await waitFor(() => expect(screen.getByText('Markdown 3')).toBeInTheDocument());

    // Make band 3 (deepest) less than band 2 -> non-monotonic.
    fireEvent.change(screen.getByLabelText(/Discount %/i, { selector: '#band3-percentage' }), {
      target: { value: '10' },
    });

    const saveButton = screen.getByRole('button', { name: /Save markdown matrix/i });
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/should not decrease/i);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('saves a valid matrix', async () => {
    mockedGet.mockResolvedValue({ matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData: false });
    mockedPut.mockResolvedValue({ matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData: false });

    render(<MarkdownMatrixSettings />);
    await waitFor(() => expect(screen.getByText('Markdown 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Save markdown matrix/i }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledOnce());
    expect(mockedPut).toHaveBeenCalledWith('/markdown-config', expect.any(Object), 'token');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Markdown matrix saved/i),
    );
  });
});
