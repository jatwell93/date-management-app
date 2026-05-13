import sgMail from '@sendgrid/mail';
import * as Sentry from '@sentry/node';

const mockDefaultPrisma = {};

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockDefaultPrisma,
}));

jest.mock('../../config/environment', () => ({
  envConfig: {
    SENDGRID_API_KEY: 'sg_test_key',
    SENDGRID_FROM_EMAIL: 'noreply@test.local',
    FRONTEND_URL: 'https://app.test.local',
  },
}));

jest.mock('../../utils/logger', () => ({
  Logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import { EmailService } from '../../services/email.service';
import { envConfig } from '../../config/environment';
import { Logger } from '../../utils/logger';

describe('email.service', () => {
  const mockPrisma = {
    organization: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockedSgMail = sgMail as unknown as {
    setApiKey: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (envConfig as any).SENDGRID_API_KEY = 'sg_test_key';
    (envConfig as any).SENDGRID_FROM_EMAIL = 'noreply@test.local';
    (envConfig as any).FRONTEND_URL = 'https://app.test.local';

    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Test Org',
      contactEmail: 'owner@test.local',
      users: [{ id: 101 }],
    });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockedSgMail.send.mockResolvedValue({});
  });

  it('sets SendGrid API key in constructor when configured', () => {
    new EmailService(mockPrisma as any);

    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('sg_test_key');
  });

  it('warns in constructor when SendGrid API key is missing', () => {
    (envConfig as any).SENDGRID_API_KEY = '';

    new EmailService(mockPrisma as any);

    expect(Logger.warn).toHaveBeenCalledWith(
      'SENDGRID_API_KEY not set. Email notifications are disabled.',
    );
  });

  it('sendEmail exits early when SendGrid is not configured', async () => {
    (envConfig as any).SENDGRID_API_KEY = '';
    const service = new EmailService(mockPrisma as any);
    jest.clearAllMocks();

    await service.sendEmail({ to: 'a@test.local', subject: 'Hello' });

    expect(Logger.warn).toHaveBeenCalledWith('Cannot send email: SendGrid not configured', {
      to: 'a@test.local',
    });
    expect(mockedSgMail.send).not.toHaveBeenCalled();
  });

  it('sendEmail sends payload with html and text', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendEmail({
      to: 'a@test.local',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      templateName: 'basic',
    });

    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'a@test.local',
      from: 'noreply@test.local',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    expect(Logger.info).toHaveBeenCalledWith('Email sent successfully', {
      to: 'a@test.local',
      subject: 'Hello',
      templateName: 'basic',
    });
  });

  it('sendEmail sends a text fallback when no body content is provided', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendEmail({
      to: 'a@test.local',
      subject: 'Hello',
    });

    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'a@test.local',
      from: 'noreply@test.local',
      subject: 'Hello',
      text: 'Hello',
    });
  });

  it('sendBulkEmail uses templateId and dynamic template data', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendBulkEmail({
      to: ['a@test.local', 'b@test.local'],
      subject: 'Bulk',
      templateId: 'template-123',
      templateData: { plan: 'premium' },
    });

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.templateId).toBe('template-123');
    expect(msg.personalizations).toHaveLength(2);
    expect(msg.personalizations[0].dynamicTemplateData).toEqual({ plan: 'premium' });
  });

  it('sendBulkEmail uses html/text content when templateId is absent', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendBulkEmail({
      to: ['a@test.local'],
      subject: 'Bulk content',
      html: '<p>H</p>',
      text: 'T',
      templateData: 'ignored-non-object',
    });

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.templateId).toBeUndefined();
    expect(msg.personalizations[0].dynamicTemplateData).toBeUndefined();
    expect(msg.content).toEqual([
      { type: 'text/html', value: '<p>H</p>' },
      { type: 'text/plain', value: 'T' },
    ]);
  });

  it('sendTrialReminderEmail returns when organization metadata is incomplete', async () => {
    const service = new EmailService(mockPrisma as any);
    mockPrisma.organization.findUnique.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      contactEmail: null,
      users: [],
    });

    await service.sendTrialReminderEmail('org-1', 3);

    expect(Logger.error).toHaveBeenCalledWith(
      'Organization, contact email, or user not found for trial reminder',
      { organizationId: 'org-1' },
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
  });

  it('sendTrialReminderEmail sends SendGrid template and logs audit event', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendTrialReminderEmail('org-1', 5);

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.templateId).toBe('d-916668c6137341c292fad8cf219cb0ee');
    expect(msg.dynamicTemplateData.daysRemaining).toBe(5);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        action: 'trial_reminder_sent',
      }),
    });
  });

  it('sendTrialReminderEmail captures and rethrows send failures', async () => {
    const service = new EmailService(mockPrisma as any);
    const sendError = new Error('send failed');
    mockedSgMail.send.mockRejectedValueOnce(sendError);

    await expect(service.sendTrialReminderEmail('org-1', 2)).rejects.toThrow('send failed');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      sendError,
      expect.objectContaining({
        tags: expect.objectContaining({ event: 'trial-reminder-email' }),
      }),
    );
  });

  it('sendOrganizationInviteEmail logs audit event when invitedByUserId is present', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendOrganizationInviteEmail({
      organizationId: 'org-1',
      toEmail: 'invitee@test.local',
      organizationName: 'Test Org',
      inviteUrl: 'https://app.test.local/invite/token',
      invitedByUserId: 101,
    });

    expect(mockedSgMail.send).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        action: 'organization_invite_sent',
        userId: 101,
      }),
    });
  });

  it('sendDunningEmail sends template email and writes audit log', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendDunningEmail('org-1', 'https://invoice.test.local/1');

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.templateId).toBe('d-731aef13fcd5415095708633599d37b6');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'dunning_email_sent' }),
    });
  });

  it('sendDowngradeWarningEmail sends template email and writes audit log', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendDowngradeWarningEmail('org-1', 1200, 1000);

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.templateId).toBe('d-a4639fceab7747d798b1931b955163e2');
    expect(msg.dynamicTemplateData.excessItems).toBe(200);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'downgrade_warning_sent' }),
    });
  });

  it('sendPaymentFailedEmail sends notification and writes audit log', async () => {
    const service = new EmailService(mockPrisma as any);

    await service.sendPaymentFailedEmail({
      organizationId: 'org-1',
      paymentIntentId: 'pi_123',
      errorMessage: 'Card declined',
    });

    const msg = mockedSgMail.send.mock.calls[0][0];
    expect(msg.subject).toContain('Payment Failed');
    expect(msg.text).toContain('Card declined');
    expect(msg.html).toContain('Payment Intent ID');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'payment_failed_email_sent' }),
    });
  });
});
