import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        active:
          'border-semantic-success/20 bg-semantic-success-muted text-semantic-success-muted-foreground',
        inactive: 'border-border bg-semantic-surface-3 text-semantic-text-secondary',
        pending:
          'border-semantic-warning/20 bg-semantic-warning-muted text-semantic-warning-muted-foreground',
        success:
          'border-semantic-success/20 bg-semantic-success-muted text-semantic-success-muted-foreground',
        error:
          'border-semantic-critical/20 bg-semantic-critical-muted text-semantic-critical-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'inactive',
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
