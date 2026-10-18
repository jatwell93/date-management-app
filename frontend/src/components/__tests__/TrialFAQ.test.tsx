import { render, screen } from '@testing-library/react';
import { TrialFAQ } from '../TrialFAQ';

describe('TrialFAQ', () => {
  it('gives the icon-only trigger an accessible name', () => {
    render(<TrialFAQ trigger="icon" />);

    expect(screen.getByRole('button', { name: 'Trial FAQ' })).toBeInTheDocument();
  });
});
