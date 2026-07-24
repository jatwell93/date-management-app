import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkdownMatrixSettings } from '../components/MarkdownMatrixSettings';
import { apiService } from '../lib/api.service';
import {
  DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownMatrixSet,
} from '@shared/markdown';
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
  const matrices: MarkdownMatrixSet = {
    NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
    FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
  };

  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
    mockGetToken.mockResolvedValue('token');
  });

  it('loads and renders the org matrix with a disabled retail option when no retail data', async () => {
    mockedGet.mockResolvedValue({
      matrices,
      matrix: DEFAULT_MARKDOWN_MATRIX,
      hasRetailData: false,
    });

    render(<MarkdownMatrixSettings />);

    await waitFor(() => expect(screen.getByText('No supplier credit')).toBeInTheDocument());
    expect(screen.getByText('Full supplier credit')).toBeInTheDocument();

    // Three retail buttons, all disabled because the org has no retail data.
    const retailButtons = screen.getAllByRole('button', { name: /^Retail$/ });
    expect(retailButtons).toHaveLength(6);
    retailButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('enables retail basis when the org has retail data', async () => {
    mockedGet.mockResolvedValue({ matrices, matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData: true });

    render(<MarkdownMatrixSettings />);

    await waitFor(() => expect(screen.getByText('No supplier credit')).toBeInTheDocument());

    screen.getAllByRole('button', { name: /^Retail$/ }).forEach((btn) => expect(btn).toBeEnabled());
  });

  it('blocks saving and shows an error when discounts decrease as expiry nears', async () => {
    mockedGet.mockResolvedValue({
      matrices,
      matrix: DEFAULT_MARKDOWN_MATRIX,
      hasRetailData: false,
    });

    render(<MarkdownMatrixSettings />);
    await waitFor(() => expect(screen.getByText('No supplier credit')).toBeInTheDocument());

    // Make band 3 (deepest) less than band 2 -> non-monotonic.
    fireEvent.change(screen.getByLabelText('No supplier credit Markdown 3 discount %'), {
      target: { value: '10' },
    });

    const saveButton = screen.getByRole('button', { name: /Save markdown matrices/i });
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/not decrease/i);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('saves both matrices once only after confirmation', async () => {
    mockedGet.mockResolvedValue({
      matrices,
      matrix: DEFAULT_MARKDOWN_MATRIX,
      hasRetailData: false,
    });
    mockedPut.mockResolvedValue({
      matrices,
      matrix: DEFAULT_MARKDOWN_MATRIX,
      hasRetailData: false,
    });

    render(<MarkdownMatrixSettings />);
    await waitFor(() => expect(screen.getByText('No supplier credit')).toBeInTheDocument());

    const saveButton = screen.getByRole('button', { name: /Save markdown matrices/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Full supplier credit Markdown 1 discount %'), {
      target: { value: '19' },
    });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/repriced immediately/i);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(mockedPut).not.toHaveBeenCalled();

    fireEvent.click(saveButton);
    fireEvent.click(screen.getByRole('button', { name: /Save and reprice/i }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledOnce());
    expect(mockedPut).toHaveBeenCalledWith(
      '/markdown-config',
      {
        matrices: expect.objectContaining({
          NO_CREDIT: matrices.NO_CREDIT,
          FULL_CREDIT: expect.any(Object),
        }),
      },
      'token',
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Markdown matrices saved/i),
    );
    expect(saveButton).toBeDisabled();
  });
});
