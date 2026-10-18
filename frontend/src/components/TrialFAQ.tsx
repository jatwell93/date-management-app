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
      'Your organization moves to the Free plan. You keep all your data. The Free plan has lower limits (500 products, 1 user), and adding new items may be blocked if you are over them. You can upgrade at any time to restore the Professional plan.',
  },
  {
    id: 'data-loss',
    icon: <AlertTriangle className="size-4" />,
    question: 'Will I lose my data?',
    answer:
      'No. Your products, inventory, and all data remain accessible. You can view and update everything. Only adding NEW items may be blocked if you are over the Free plan limits.',
  },
  {
    id: 'creation-lock',
    icon: <Lock className="size-4" />,
    question: 'What is a creation lock?',
    answer:
      'When your trial has ended and you have not upgraded, adding new products, inventory items, or users may be blocked. Your existing data stays available, and upgrading lifts the block.',
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
      'No. Your organization moves to the Free plan as soon as the trial ends, on the end date shown in your trial banner. You can upgrade at any time afterwards and your data is kept.',
  },
  {
    id: 'export-data',
    icon: <Lock className="size-4" />,
    question: 'Can I export my data before the trial ends?',
    answer:
      'There is no in-app export yet. If you are over the Free plan limits, the API endpoint GET /api/products/export-excess returns the products over the limit. For a full copy of your data, contact support.',
  },
  {
    id: 'limits',
    icon: <AlertTriangle className="size-4" />,
    question: 'What are the Free plan limits?',
    answer:
      'The Free plan includes 500 products (SKUs), 1 user, 500 inventory items, and 1 GB of storage. If you are over these when your trial ends, adding new items may be blocked until you upgrade or reduce usage.',
  },
];

function FAQList() {
  return (
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
  );
}

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
          <FAQList />
        </div>

        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
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

      <FAQList />
    </div>
  );
}

export default TrialFAQ;
