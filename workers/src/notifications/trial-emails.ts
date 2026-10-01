/**
 * Trial lifecycle email bodies — pure renderers so the subject/body copy is
 * unit-testable without a queue, database or provider (task 3.3b, matrix row 5).
 *
 * Dates render in the organization's home timezone rather than UTC so "ends on
 * 12 October" matches what an Australian pharmacist sees on their calendar.
 * The org name is escaped on the html side only — the text part is verbatim.
 */
import { escapeHtml } from '../../../shared/domain/credit-claim-email';

export interface RenderedTrialEmail {
  subject: string;
  html: string;
  text: string;
}

const trialDate = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Australia/Sydney',
});

function formatTrialEnd(end: Date): string {
  return trialDate.format(end);
}

/**
 * The upgrade link, or null when `FRONTEND_URL` is unset — in that case the
 * link sentence is omitted entirely rather than pointing at a placeholder.
 */
function upgradeLink(frontendUrl: string | undefined): string | null {
  const base = (frontendUrl || '').replace(/\/+$/, '');
  return base ? `${base}/upgrade` : null;
}

/**
 * "Your free trial ends in N day(s)" — sent at the 10/5/2-day thresholds. The
 * reminder exists because the Worker derives trial lapse from `trial_end_date`
 * on every request rather than ever writing a downgrade, so the email is the
 * only notice a lapsed org gets.
 */
export function renderTrialReminderEmail(input: {
  organizationName: string;
  trialEndDate: Date;
  daysRemaining: number;
  frontendUrl?: string;
}): RenderedTrialEmail {
  const days = Math.max(1, Math.floor(input.daysRemaining));
  const subject = `Your free trial ends in ${days} ${days === 1 ? 'day' : 'days'}`;
  const end = formatTrialEnd(input.trialEndDate);
  const link = upgradeLink(input.frontendUrl);

  const textSentences = [
    `Your Professional trial for ${input.organizationName} ends on ${end}.`,
    link ? `Upgrade to keep your Professional features: ${link}.` : null,
    'When the trial ends, your organization moves to the Free plan — your data is kept.',
  ].filter((s): s is string => s !== null);

  const htmlParagraphs = [
    `<p>Your Professional trial for ${escapeHtml(input.organizationName)} ends on ${end}.</p>`,
    link
      ? `<p><a href="${escapeHtml(link)}">Upgrade to keep your Professional features</a>.</p>`
      : null,
    '<p>When the trial ends, your organization moves to the Free plan — your data is kept.</p>',
  ].filter((p): p is string => p !== null);

  return {
    subject,
    html:
      `<div style="font-family: Arial, sans-serif; max-width: 640px;">` +
      htmlParagraphs.join('') +
      `</div>`,
    text: textSentences.join(' '),
  };
}

/** "Your free trial has ended" — sent once, inside a short lookback window after `trial_end_date`. */
export function renderTrialEndedEmail(input: {
  organizationName: string;
  trialEndDate: Date;
  frontendUrl?: string;
}): RenderedTrialEmail {
  const end = formatTrialEnd(input.trialEndDate);
  const link = upgradeLink(input.frontendUrl);

  const textSentences = [
    `Your Professional trial for ${input.organizationName} ended on ${end}.`,
    'Your organization is now on the Free plan and your data is kept.',
    link ? `You can upgrade any time: ${link}.` : null,
  ].filter((s): s is string => s !== null);

  const htmlParagraphs = [
    `<p>Your Professional trial for ${escapeHtml(input.organizationName)} ended on ${end}.</p>`,
    '<p>Your organization is now on the Free plan and your data is kept.</p>',
    link ? `<p><a href="${escapeHtml(link)}">You can upgrade any time</a>.</p>` : null,
  ].filter((p): p is string => p !== null);

  return {
    subject: 'Your free trial has ended',
    html:
      `<div style="font-family: Arial, sans-serif; max-width: 640px;">` +
      htmlParagraphs.join('') +
      `</div>`,
    text: textSentences.join(' '),
  };
}
