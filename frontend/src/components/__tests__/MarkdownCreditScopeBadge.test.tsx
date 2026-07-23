import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarkdownCreditScopeBadge } from '../MarkdownCreditScopeBadge';

describe('MarkdownCreditScopeBadge', () => {
  it('links missing policy to the matching supplier in policy review', () => {
    render(
      <MemoryRouter>
        <MarkdownCreditScopeBadge
          creditScope="NO_CREDIT"
          creditScopeReason="NO_POLICY"
          creditSupplierId={42}
          creditSupplierName="Example Supplier"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('No policy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review policy/i })).toHaveAttribute(
      'href',
      '/supplier-credits?view=policy-review&supplierId=42',
    );
  });

  it.each(['PENDING_CONFIRMATION', 'NEEDS_BRAND'] as const)(
    'links %s to catalogue review',
    (reason) => {
      render(
        <MemoryRouter>
          <MarkdownCreditScopeBadge
            creditScope="NO_CREDIT"
            creditScopeReason={reason}
            creditSupplierId={null}
            creditSupplierName={null}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('link', { name: /Review catalogue/i })).toHaveAttribute(
        'href',
        '/supplier-credits?view=catalogue-review',
      );
    },
  );

  it('renders confirmed full credit compactly without a warning action', () => {
    render(
      <MemoryRouter>
        <MarkdownCreditScopeBadge
          creditScope="FULL_CREDIT"
          creditScopeReason="FULL_CREDIT"
          creditSupplierId={7}
          creditSupplierName="Credited Supplier"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Full credit')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
