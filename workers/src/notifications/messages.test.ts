/**
 * Unit coverage for the notification queue's message contract: the parser the
 * consumer gates every delivery on, plus the env helpers the producing jobs
 * share (Resend-configured vs queue-bound — different failure postures).
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../types/env';
import {
  isResendConfigured,
  parseNotificationEmailMessage,
  requireNotificationEmailQueue,
} from './messages';

describe('parseNotificationEmailMessage', () => {
  it('accepts each valid message kind', () => {
    expect(
      parseNotificationEmailMessage({
        kind: 'trial-reminder',
        organizationId: 'org_1',
        trialEndDate: '2030-06-15T12:00:00.000Z',
        threshold: 5,
      }),
    ).toEqual({
      kind: 'trial-reminder',
      organizationId: 'org_1',
      trialEndDate: '2030-06-15T12:00:00.000Z',
      threshold: 5,
    });
    expect(
      parseNotificationEmailMessage({
        kind: 'trial-ended',
        organizationId: 'org_1',
        trialEndDate: '2030-06-15T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'trial-ended',
      organizationId: 'org_1',
      trialEndDate: '2030-06-15T12:00:00.000Z',
    });
    expect(
      parseNotificationEmailMessage({
        kind: 'credit-claim-follow-up',
        organizationId: 'org_1',
        claimId: 42,
      }),
    ).toEqual({ kind: 'credit-claim-follow-up', organizationId: 'org_1', claimId: 42 });
  });

  it.each([
    ['a non-object', 'hello'],
    ['null', null],
    ['an unknown kind', { kind: 'trial-reminderr', organizationId: 'o' }],
    ['a missing organizationId', { kind: 'trial-ended', trialEndDate: '2030-01-01T00:00:00Z' }],
    [
      'a malformed trialEndDate',
      {
        kind: 'trial-ended',
        organizationId: 'o',
        trialEndDate: 'not-a-date',
      },
    ],
    [
      'a threshold outside 10/5/2',
      {
        kind: 'trial-reminder',
        organizationId: 'o',
        trialEndDate: '2030-01-01T00:00:00Z',
        threshold: 7,
      },
    ],
    [
      'a missing threshold',
      { kind: 'trial-reminder', organizationId: 'o', trialEndDate: '2030-01-01T00:00:00Z' },
    ],
    ['a string claimId', { kind: 'credit-claim-follow-up', organizationId: 'o', claimId: '42' }],
    ['a non-positive claimId', { kind: 'credit-claim-follow-up', organizationId: 'o', claimId: 0 }],
    ['a fractional claimId', { kind: 'credit-claim-follow-up', organizationId: 'o', claimId: 1.5 }],
    // A catalogue-import message shape must never reach the claim path.
    ['a catalogue import message', { uploadId: 42 }],
  ])('rejects %s', (_label, body) => {
    expect(parseNotificationEmailMessage(body)).toBeNull();
  });
});

describe('env helpers', () => {
  it('isResendConfigured requires both secrets', () => {
    const env = (over: Partial<Env>) => ({ ...over }) as Env;
    expect(isResendConfigured(env({}))).toBe(false);
    expect(isResendConfigured(env({ RESEND_API_KEY: 'k' }))).toBe(false);
    expect(isResendConfigured(env({ RESEND_FROM_EMAIL: 'x@y.z' }))).toBe(false);
    expect(isResendConfigured(env({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'x@y.z' }))).toBe(true);
  });

  it('requireNotificationEmailQueue returns the binding or throws', () => {
    const queue = { sendBatch: async () => ({}) } as unknown as Env['NOTIFICATION_EMAIL_QUEUE'];
    expect(requireNotificationEmailQueue({ NOTIFICATION_EMAIL_QUEUE: queue } as Env)).toBe(queue);
    expect(() => requireNotificationEmailQueue({} as Env)).toThrow(/NOTIFICATION_EMAIL_QUEUE/);
  });
});
