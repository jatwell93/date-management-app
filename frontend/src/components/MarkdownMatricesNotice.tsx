import { Button } from './ui/button';
import type { MarkdownMatricesState } from '../hooks/useMarkdownMatrix';

type Props = Pick<MarkdownMatricesState, 'status' | 'error' | 'retry'>;

export function MarkdownMatricesNotice({ status, error, retry }: Props) {
  if (status === 'ready') return null;
  if (status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading markdown pricing…
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-semantic-critical">
      <span>{error ?? 'Markdown pricing is unavailable.'}</span>
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
