import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { cn } from '../../lib/utils';

const POLICY_MARKDOWN_ELEMENTS = ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em'];

interface Props {
  value: string;
  className?: string;
}

export const PolicyMarkdown: React.FC<Props> = ({ value, className }) => (
  <div
    className={cn(
      'space-y-2 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5',
      className,
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      skipHtml
      allowedElements={POLICY_MARKDOWN_ELEMENTS}
      unwrapDisallowed
    >
      {value}
    </ReactMarkdown>
  </div>
);
