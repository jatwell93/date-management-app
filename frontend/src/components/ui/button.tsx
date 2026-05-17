import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-semantic-primary focus-visible:ring-semantic-primary/50 focus-visible:ring-[3px] aria-invalid:ring-semantic-critical/20 dark:aria-invalid:ring-semantic-critical/40 aria-invalid:border-semantic-critical",
  {
    variants: {
      variant: {
        default:
          'bg-semantic-primary text-semantic-primary-foreground hover:bg-semantic-primary-hover active:bg-semantic-primary-active',
        destructive:
          'bg-semantic-critical text-semantic-critical-foreground hover:bg-semantic-critical-hover active:bg-semantic-critical-active focus-visible:ring-semantic-critical/20 dark:focus-visible:ring-semantic-critical/40',
        outline:
          'border border-input bg-semantic-surface-1 text-semantic-text-primary shadow-xs hover:bg-semantic-surface-2 dark:bg-semantic-surface-2 dark:hover:bg-semantic-surface-3',
        secondary:
          'bg-semantic-secondary text-semantic-secondary-foreground hover:bg-semantic-secondary-hover active:bg-semantic-secondary-active',
        ghost:
          'text-semantic-text-primary hover:bg-semantic-surface-2 hover:text-semantic-text-primary dark:hover:bg-semantic-surface-3',
        link: 'text-semantic-secondary underline-offset-4 hover:underline',
        success:
          'bg-semantic-success text-semantic-success-foreground hover:bg-semantic-success-hover active:bg-semantic-success-active',
        warning:
          'bg-semantic-warning text-semantic-warning-foreground hover:bg-semantic-warning-hover active:bg-semantic-warning-active',
        error:
          'bg-semantic-critical text-semantic-critical-foreground hover:bg-semantic-critical-hover active:bg-semantic-critical-active',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
