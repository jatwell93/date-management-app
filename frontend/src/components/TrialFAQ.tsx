import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { HelpCircle, Clock, Lock, CreditCard, Mail, AlertTriangle } from 'lucide-react';

interface TrialFAQProps {
  daysRemaining?: number;
  isExpired?: boolean;
  trigger?: 'button' | 'link' | 'icon';
}

const faqData = [
  {
    id: 'what-happens',
    icon: <Clock className="size-4" />,
    question: 'What happens when my trial expires?',
    answer:
      'Your account automatically converts to the free Starter tier. You keep all your data, but new creations are blocked if you exceed Starter limits (500 SKUs, 1 user). You can upgrade at any time to restore full access.',
  },
  {
    id: 'data-loss',
    icon: <AlertTriangle className="size-4" />,
    question: 'Will I lose my data?',
    answer:
      'No. Your products, inventory, and all data remain fully accessible. You can view, update, and export everything. Only adding NEW items is blocked if you are over the Starter tier limits.',
  },
  {
    id: 'creation-lock',
    icon: <Lock className="size-4" />,
    question: 'What is a creation lock?',
    answer:
      'A creation lock prevents adding new products, inventory items, or users when your usage exceeds your tier limits. It is automatically removed when you upgrade or reduce usage to within limits.',
  },
  {
    id: 'upgrade-anytime',
    icon: <CreditCard className="size-4" />,
    question: 'Can I upgrade after my trial expires?',
    answer:
      'Yes! You can upgrade at any time - even after expiration. Once you upgrade, all features are immediately restored and any creation lock is removed.',
  },
  {
    id: 'reminders',
    icon: <Mail className="size-4" />,
    question: 'When will I receive reminder emails?',
    answer:
      'We send reminder emails at 10, 5, and 2 days before your trial expires. These include upgrade links and information about what happens after expiration.',
  },
  {
    id: 'grace-period',
    icon: <Clock className="size-4" />,
    question: 'Is there a grace period after expiration?',
    answer:
      'Yes, you have a 48-hour grace period after expiration to add a payment method without any interruption. During this time, all Professional tier features remain available.',
  },
  {
    id: 'export-data',
    icon: <Lock className="size-4" />,
    question: 'Can I export my data before the trial ends?',
    answer:
      'Yes! You can export your products anytime from Settings → Export Data, or use the API endpoint GET /api/products/export-excess to create a backup.',
  },
  {
    id: 'limits',
    icon: <AlertTriangle className="size-4" />,
    question: 'What are the Starter tier limits?',
    answer:
      'The Starter tier includes: 500 SKUs (products), 1 user, 5,000 inventory items, and 1 GB storage. If you have more than this when your trial expires, a creation lock will be applied.',
  },
];

export function TrialFAQ({ daysRemaining, isExpired, trigger = 'button' }: TrialFAQProps) {
  const [open, setOpen] = useState(false);

  const getTriggerButton = () => {
    switch (trigger) {
      case 'icon':
        return (
          <Button variant="ghost" size="icon" className="size-8">
            <HelpCircle className="size-4" />
          </Button>
        );
      case 'link':
        return (
          <Button variant="link" size="sm" className="h-auto p-0">
            FAQ
          </Button>
        );
      default:
        return (
          <Button variant="outline" size="sm" className="gap-2">
            <HelpCircle className="size-4" />
            Trial FAQ
          </Button>
        );
    }
  };

  const getHeaderContent = () => {
    if (isExpired) {
      return {
        title: 'Trial Expired - What Now?',
        description:
          'Your Professional trial has ended. Learn what happens next and how to restore full access.',
      };
    }
    if (daysRemaining && daysRemaining <= 3) {
      return {
        title: `Only ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'} Left!`,
        description:
          'Your trial is ending soon. Here are common questions about what happens next.',
      };
    }
    return {
      title: 'Trial FAQ',
      description: 'Common questions about your trial, expiration, and account options.',
    };
  };

  const headerContent = getHeaderContent();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{getTriggerButton()}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="size-5" />
            {headerContent.title}
          </DialogTitle>
          <DialogDescription>{headerContent.description}</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <div className="w-full divide-y rounded-md border">
            {faqData.map((item) => (
              <details key={item.id} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-3 text-left text-sm font-medium">
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span>{item.question}</span>
                </summary>
                <p className="text-muted-foreground pl-7 pt-3 text-sm">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Need more help? Contact support at{' '}
            <a href="mailto:support@yourdomain.com" className="underline">
              support@yourdomain.com
            </a>{' '}
            or visit our{' '}
            <a
              href="/docs/trial-expiration-faq"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              full documentation
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrialFAQInline() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold font-heading flex items-center gap-2">
        <HelpCircle className="size-5" />
        Frequently Asked Questions
      </h3>

      <div className="w-full divide-y rounded-md border">
        {faqData.map((item) => (
          <details key={item.id} className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-3 text-left text-sm font-medium">
              <span className="text-muted-foreground">{item.icon}</span>
              <span>{item.question}</span>
            </summary>
            <p className="text-muted-foreground pl-7 pt-3 text-sm">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export default TrialFAQ;
