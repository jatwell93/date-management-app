import { fireEvent, render, screen } from '@testing-library/react';
import { TrialFAQ } from '../TrialFAQ';

describe('TrialFAQ', () => {
  it('gives the icon-only trigger an accessible name', () => {
    render(<TrialFAQ trigger="icon" />);

    expect(screen.getByRole('button', { name: 'Trial FAQ' })).toBeInTheDocument();
  });

  it('uses calm, clinical copy when the trial is nearly over', async () => {
    render(<TrialFAQ daysRemaining={2} />);

    fireEvent.click(screen.getByRole('button', { name: /Trial FAQ/ }));

    expect(
      await screen.findByRole('heading', { name: '2 days left in your trial' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Left!/)).not.toBeInTheDocument();
  });
});
