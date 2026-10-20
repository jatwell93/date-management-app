import { render, screen } from '@testing-library/react';

import { SHELL_MAIN_ID, SkipToContent } from '../shellMain';

describe('SkipToContent', () => {
  it('links to the shell main landmark and is the first tab stop', () => {
    render(
      <>
        <SkipToContent />
        <nav aria-label="Main">
          <a href="/scan">Scan</a>
        </nav>
        <main id={SHELL_MAIN_ID} tabIndex={-1}>
          Page
        </main>
      </>,
    );

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', `#${SHELL_MAIN_ID}`);
    expect(skip).toHaveClass('sr-only', 'focus:not-sr-only', 'focus:min-h-11');

    skip.focus();
    expect(skip).toHaveFocus();
    expect(document.querySelector(`#${SHELL_MAIN_ID}`)).toBe(screen.getByRole('main'));
  });
});
