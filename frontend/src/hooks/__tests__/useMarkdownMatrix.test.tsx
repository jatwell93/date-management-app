import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX, DEFAULT_MARKDOWN_MATRIX } from '@shared/markdown';
import { apiService } from '../../lib/api.service';
import { useMarkdownMatrices } from '../useMarkdownMatrix';

const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock('../../lib/api.service', () => ({
  apiService: { get: vi.fn() },
}));

const mockedGet = apiService.get as jest.Mock;

describe('useMarkdownMatrices', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockGetToken.mockResolvedValue('fresh-token');
  });

  it('does not expose printable matrices before the organization config is ready', async () => {
    let resolveRequest!: (value: unknown) => void;
    mockedGet.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)));

    const { result } = renderHook(() => useMarkdownMatrices('stale-token'));

    expect(result.current.status).toBe('loading');
    expect(result.current.matrices).toBeNull();

    act(() =>
      resolveRequest({
        matrices: {
          NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
          FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
        },
        matrix: DEFAULT_MARKDOWN_MATRIX,
        hasRetailData: false,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.matrices?.FULL_CREDIT).toEqual(DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX);
  });

  it('reports a retryable error without falling back to a printable default', async () => {
    mockedGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      matrices: {
        NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
        FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
      },
      matrix: DEFAULT_MARKDOWN_MATRIX,
      hasRetailData: false,
    });

    const { result } = renderHook(() => useMarkdownMatrices(null));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.matrices).toBeNull();
    expect(result.current.error).toMatch(/could not load/i);

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    expect(result.current.matrices).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('hides matrices from the previous token while the next organization loads', async () => {
    let resolveNextRequest!: (value: unknown) => void;
    mockedGet
      .mockResolvedValueOnce({
        matrices: {
          NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
          FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
        },
        matrix: DEFAULT_MARKDOWN_MATRIX,
        hasRetailData: false,
      })
      .mockReturnValueOnce(new Promise((resolve) => (resolveNextRequest = resolve)));

    const { result, rerender } = renderHook(({ token }) => useMarkdownMatrices(token), {
      initialProps: { token: 'org-one-token' },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ token: 'org-two-token' });
    expect(result.current.status).toBe('loading');
    expect(result.current.matrices).toBeNull();

    act(() =>
      resolveNextRequest({
        matrices: {
          NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
          FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
        },
        matrix: DEFAULT_MARKDOWN_MATRIX,
        hasRetailData: false,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
