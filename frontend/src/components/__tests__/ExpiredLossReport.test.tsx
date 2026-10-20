import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExpiredLossReport from '../ExpiredLossReport';
import { getExpiredLossesReport } from '../../services/expiredItemService';

vi.mock('../../hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, vi.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

vi.mock('../../services/expiredItemService', () => ({
  getExpiredLossesReport: vi.fn(),
}));

describe('ExpiredLossReport', () => {
  const mockedReport = getExpiredLossesReport as jest.MockedFunction<typeof getExpiredLossesReport>;

  beforeEach(() => {
    mockedReport.mockReset();
  });

  it('shows the auth error instead of loading forever when the token is missing', async () => {
    render(<ExpiredLossReport token={null} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication token not found');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('announces loading and then a fetch failure', async () => {
    mockedReport.mockRejectedValue(new Error('boom'));

    render(<ExpiredLossReport token="test-session-value" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading expired losses report/);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to fetch expired losses report',
    );
  });

  it('renders empty states inside a labelled section when there are no losses', async () => {
    mockedReport.mockResolvedValue({ lossesBySKU: [], lossesByStoreArea: [] });

    render(<ExpiredLossReport token="test-session-value" />);

    expect(
      await screen.findByRole('region', { name: 'Expired Item Loss Report' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No SKU losses recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No store area losses recorded yet.')).toBeInTheDocument();
  });

  it('formats losses as AUD with tabular numerals', async () => {
    mockedReport.mockResolvedValue({
      lossesBySKU: [{ sku: 'VAC-100', productName: 'Cold Chain Vaccine', totalLoss: 1234.5 }],
      lossesByStoreArea: [{ locationName: 'Fridge', totalLoss: 1234.5 }],
    });

    render(<ExpiredLossReport token="test-session-value" />);

    const cells = await screen.findAllByText('$1,234.50');
    expect(cells).toHaveLength(2);
    cells.forEach((cell) => expect(cell).toHaveClass('tabular-nums'));
    expect(screen.queryByText(/No .* losses recorded yet/)).not.toBeInTheDocument();
  });
});
