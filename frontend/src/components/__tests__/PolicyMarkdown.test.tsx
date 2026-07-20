import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PolicyMarkdown } from '../supplier-credits/PolicyMarkdown';

describe('PolicyMarkdown', () => {
  it('renders supported policy formatting and hard line breaks', () => {
    const { container } = render(
      <PolicyMarkdown
        value={'First line\nSecond line\n\n- One\n- Two\n\n**Important** and *careful*'}
      />,
    );

    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getByText('Important').tagName).toBe('STRONG');
    expect(screen.getByText('careful').tagName).toBe('EM');
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('ignores raw HTML, images, and links while retaining safe link text', () => {
    const { container } = render(
      <PolicyMarkdown
        value={
          '<script>window.policyAttack = true</script>\n\n<img src=x onerror="window.policyAttack = true">\n\n[Supplier portal](https://example.com)'
        }
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('Supplier portal')).toBeInTheDocument();
    expect((window as Window & { policyAttack?: boolean }).policyAttack).toBeUndefined();
  });
});
