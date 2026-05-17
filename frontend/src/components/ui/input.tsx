import * as React from 'react';

import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-semantic-text-primary placeholder:text-semantic-text-muted selection:bg-semantic-primary selection:text-semantic-primary-foreground dark:bg-semantic-surface-2 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-semantic-primary focus-visible:ring-semantic-primary/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-semantic-critical/20 dark:aria-invalid:ring-semantic-critical/40 aria-invalid:border-semantic-critical',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
