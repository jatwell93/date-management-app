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

  const renderLoaded = async (hasRetailData = false) => {
    mockedGet.mockResolvedValue({ matrices, matrix: DEFAULT_MARKDOWN_MATRIX, hasRetailData });
    render(<MarkdownMatrixSettings />);
    await waitFor(() => expect(screen.getByText('No supplier credit')).toBeInTheDocument());
  };

  it('announces the loading state', () => {
    mockedGet.mockReturnValue(new Promise(() => undefined));
    render(<MarkdownMatrixSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading markdown settings');
  });

  it('exposes a level-2 heading and a visible focus ring on basis toggles', async () => {
    await renderLoaded(true);

    expect(screen.getByRole('heading', { level: 2, name: 'Markdown matrices' })).toHaveAttribute(
      'id',
      'markdown-matrices-heading',
    );
    screen
      .getAllByRole('button', { name: /^(Cost|Retail)$/ })
      .forEach((btn) => expect(btn).toHaveClass('focus-visible:ring-[3px]'));
    // Selected basis uses the teal semantic primary, not the navy shadcn primary.
    const [cost] = screen.getAllByRole('button', { name: 'Cost', pressed: true });
    expect(cost).toHaveClass('bg-semantic-primary', 'text-semantic-primary-foreground');
  });

  it('explains the disabled retail basis to assistive tech', async () => {
    await renderLoaded(false);

    const [retail] = screen.getAllByRole('button', { name: /^Retail$/ });
    expect(retail).toHaveAccessibleDescription(/retail \(or selling price\) column/i);
  });

  it('ties the validation error to the invalid scope inputs', async () => {
    await renderLoaded();

    const band3 = screen.getByLabelText('No supplier credit Markdown 3 Discount %');
    expect(band3).not.toHaveAttribute('aria-invalid');
    fireEvent.change(band3, { target: { value: '10' } });

    expect(band3).toHaveAttribute('aria-invalid', 'true');
    expect(band3).toHaveAccessibleDescription(/must not decrease/i);
    expect(screen.getByLabelText('Full supplier credit Markdown 3 Discount %')).not.toHaveAttribute(
      'aria-invalid',
    );
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
    fireEvent.change(screen.getByLabelText('No supplier credit Markdown 3 Discount %'), {
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

    fireEvent.change(screen.getByLabelText('Full supplier credit Markdown 1 Discount %'), {
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
    // AA contrast: the success text uses the dark muted-foreground green, not #10B981.
    expect(screen.getByRole('status')).toHaveClass('text-semantic-success-muted-foreground');
    expect(saveButton).toBeDisabled();
  });
});
