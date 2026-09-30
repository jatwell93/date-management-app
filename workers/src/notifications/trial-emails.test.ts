/**
 * Unit coverage for the trial lifecycle email renderers: the day-count
 * singular/plural switch in the subject, HTML escaping of the organization
 * name (it is user-supplied via Clerk org names), the FRONTEND_URL-dependent
 * upgrade link, and the Australia/Sydney date formatting.
 */
import { describe, expect, it } from 'vitest';
import { renderTrialEndedEmail, renderTrialReminderEmail } from './trial-emails';

const ORG = 'Acme Pharmacy';
const END = new Date('2026-10-12T00:00:00.000Z'); // 12 Oct, 11:00 in Australia/Sydney
const FRONTEND_URL = 'https://app.example.com/';

describe('renderTrialReminderEmail', () => {
  it('pluralizes the subject for multi-day reminders', () => {
    const email = renderTrialReminderEmail({
      organizationName: ORG,
      trialEndDate: END,
      daysRemaining: 10,
      frontendUrl: FRONTEND_URL,
    });
    expect(email.subject).toBe('Your free trial ends in 10 days');
  });

  it('uses the singular for a one-day reminder', () => {
    const email = renderTrialReminderEmail({
      organizationName: ORG,
      trialEndDate: END,
      daysRemaining: 1,
      frontendUrl: FRONTEND_URL,
    });
    expect(email.subject).toBe('Your free trial ends in 1 day');
  });

  it('names the trial end in Australia/Sydney and carries the upgrade link', () => {
    const email = renderTrialReminderEmail({
      organizationName: ORG,
      trialEndDate: END,
      daysRemaining: 5,
      frontendUrl: FRONTEND_URL,
    });
    expect(email.text).toContain(
      'Your Professional trial for Acme Pharmacy ends on 12 October 2026',
    );
    // The trailing slash on FRONTEND_URL must not double up in the link.
    expect(email.text).toContain('https://app.example.com/upgrade');
    expect(email.text).not.toContain('//upgrade');
    expect(email.text).toContain('your data is kept');
    expect(email.html).toContain('href="https://app.example.com/upgrade"');
  });

  it('omits the upgrade sentence entirely when FRONTEND_URL is unset', () => {
    const email = renderTrialReminderEmail({
      organizationName: ORG,
      trialEndDate: END,
      daysRemaining: 2,
    });
    expect(email.text).not.toContain('Upgrade to keep');
    expect(email.text).not.toContain('/upgrade');
    expect(email.html).not.toContain('href');
    // The rest of the body still reads correctly without the link.
    expect(email.text).toContain('ends on 12 October 2026');
    expect(email.text).toContain('moves to the Free plan');
  });

  it('HTML-escapes the organization name but leaves the text part verbatim', () => {
    const email = renderTrialReminderEmail({
      organizationName: 'A&B <x>',
      trialEndDate: END,
      daysRemaining: 2,
      frontendUrl: FRONTEND_URL,
    });
    expect(email.html).toContain('A&amp;B &lt;x&gt;');
    expect(email.html).not.toContain('A&B <x>');
    expect(email.text).toContain('A&B <x>');
  });
});

describe('renderTrialEndedEmail', () => {
  it('reports the ended trial with the upgrade-any-time link', () => {
    const email = renderTrialEndedEmail({
      organizationName: ORG,
      trialEndDate: END,
      frontendUrl: FRONTEND_URL,
    });
    expect(email.subject).toBe('Your free trial has ended');
    expect(email.text).toContain(
      'Your Professional trial for Acme Pharmacy ended on 12 October 2026',
    );
    expect(email.text).toContain('now on the Free plan');
    expect(email.text).toContain('https://app.example.com/upgrade');
  });

  it('omits the link sentence when FRONTEND_URL is unset', () => {
    const email = renderTrialEndedEmail({ organizationName: ORG, trialEndDate: END });
    expect(email.text).not.toContain('upgrade');
    expect(email.text).toContain('your data is kept');
  });

  it('HTML-escapes the organization name', () => {
    const email = renderTrialEndedEmail({
      organizationName: 'A&B <x>',
      trialEndDate: END,
    });
    expect(email.html).toContain('A&amp;B &lt;x&gt;');
  });
});
