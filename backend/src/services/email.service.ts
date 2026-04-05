/**
 * Email Service
 *
 * Handles email notifications using SendGrid.
 * Implements trial reminders, dunning emails, and downgrade warnings.
 *
 * DECISION 17.5.4: Use SendGrid for all email notifications.
 */

import sgMail from '@sendgrid/mail';
import { PrismaClient } from '@prisma/client';
import { envConfig } from '../config/environment';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

const TEMPLATE_IDS = {
  trialEndingSoon: 'd-916668c6137341c292fad8cf219cb0ee',
  paymentFailed: 'd-731aef13fcd5415095708633599d37b6',
  downgradeWarning: 'd-a4639fceab7747d798b1931b955163e2',
};

interface BulkEmailPersonalization {
  to: Array<{ email: string }>;
  dynamicTemplateData?: Record<string, unknown>;
}

interface BulkEmailPayload {
  from: string;
  subject: string;
  personalizations: BulkEmailPersonalization[];
  templateId?: string;
  content?: Array<{ type: 'text/html' | 'text/plain'; value: string }>;
}

function toTemplateRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export class EmailService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();

    if (envConfig.SENDGRID_API_KEY) {
      sgMail.setApiKey(envConfig.SENDGRID_API_KEY);
    } else {
      Logger.warn('SENDGRID_API_KEY not set. Email notifications are disabled.');
    }
  }

  /**
   * Send trial reminder email when trial is ending soon
   *
   * @param organizationId - Organization UUID
   * @param daysRemaining - Days until trial ends
   */
  async sendTrialReminderEmail(organizationId: string, daysRemaining: number): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send trial reminder: SendGrid not configured', { organizationId });
        return;
      }

      // Query organization details
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          users: {
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!organization || !organization.contactEmail || !organization.users[0]) {
        Logger.error('Organization, contact email, or user not found for trial reminder', {
          organizationId,
        });
        return;
      }

      const userEmail = organization.contactEmail;
      const organizationName = organization.name;

      const appUrl = envConfig.FRONTEND_URL;
      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
      const msg = {
        to: userEmail,
        from: fromEmail,
        subject: 'Trial Ending Soon',
        templateId: TEMPLATE_IDS.trialEndingSoon,
        dynamicTemplateData: {
          organizationName,
          daysRemaining,
          upgradeUrl: `${appUrl}/upgrade`,
          appUrl,
        },
      };

      await sgMail.send(msg);

      // Log trial_reminder_sent event
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'trial_reminder_sent',
          userId: organization.users[0].id,
          changeDescription: `Trial reminder sent: ${daysRemaining} days remaining`,
        },
      });

      Logger.info('Trial reminder email sent', { organizationId, daysRemaining, userEmail });
    } catch (error) {
      Logger.error('Failed to send trial reminder email', {
        organizationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Sentry.captureException(error, {
        level: 'error',
        tags: { service: 'email-service', event: 'trial-reminder-email' },
        extra: { organizationId, template: 'trialEndingSoon' },
      });
      throw error;
    }
  }

  /**
   * Send organization invite email
   */
  async sendOrganizationInviteEmail(params: {
    organizationId: string;
    toEmail: string;
    organizationName: string;
    inviteUrl: string;
    invitedByUserId?: number;
  }): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send invite: SendGrid not configured', {
          organizationId: params.organizationId,
        });
        return;
      }

      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
      const appUrl = envConfig.FRONTEND_URL;
      const msg = {
        to: params.toEmail,
        from: fromEmail,
        subject: `You're invited to ${params.organizationName}`,
        text: `You have been invited to join ${params.organizationName}. Accept your invite: ${params.inviteUrl}`,
        html: `<p>You have been invited to join <strong>${params.organizationName}</strong>.</p><p><a href="${params.inviteUrl}">Accept your invite</a></p><p>${appUrl}</p>`,
      };

      await sgMail.send(msg);

      if (params.invitedByUserId) {
        await this.prisma.auditLog.create({
          data: {
            organizationId: params.organizationId,
            action: 'organization_invite_sent',
            userId: params.invitedByUserId,
            changeDescription: `Invite sent to ${params.toEmail}`,
          },
        });
      }

      Logger.info('Organization invite email sent', {
        organizationId: params.organizationId,
        toEmail: params.toEmail,
      });
    } catch (error) {
      Logger.error('Failed to send organization invite email', {
        organizationId: params.organizationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Sentry.captureException(error, {
        level: 'error',
        tags: { service: 'email-service', event: 'organization-invite-email' },
        extra: {
          organizationId: params.organizationId,
          toEmail: params.toEmail,
          template: 'organizationInvite',
        },
      });
      throw error;
    }
  }

  /**
   * Send dunning email when payment fails
   *
   * @param organizationId - Organization UUID
   * @param invoiceUrl - Stripe hosted invoice URL
   */
  async sendDunningEmail(organizationId: string, invoiceUrl?: string): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send dunning email: SendGrid not configured', { organizationId });
        return;
      }

      // Query organization details
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          users: {
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!organization || !organization.contactEmail || !organization.users[0]) {
        Logger.error('Organization, contact email, or user not found for dunning email', {
          organizationId,
        });
        return;
      }

      const userEmail = organization.contactEmail;
      const organizationName = organization.name;

      const appUrl = envConfig.FRONTEND_URL;
      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
      const msg = {
        to: userEmail,
        from: fromEmail,
        subject: 'Payment Failed',
        templateId: TEMPLATE_IDS.paymentFailed,
        dynamicTemplateData: {
          organizationName,
          invoiceUrl: invoiceUrl || `${appUrl}/billing`,
          billingUrl: `${appUrl}/billing`,
          appUrl,
        },
      };

      await sgMail.send(msg);

      // Log dunning_email_sent event
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'dunning_email_sent',
          userId: organization.users[0].id,
          changeDescription: `Dunning email sent for failed payment`,
        },
      });

      Logger.info('Dunning email sent', { organizationId, userEmail });
    } catch (error) {
      Logger.error('Failed to send dunning email', {
        organizationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Sentry.captureException(error, {
        level: 'error',
        tags: { service: 'email-service', event: 'dunning-email' },
        extra: { organizationId, template: 'dunning' },
      });
      throw error;
    }
  }

  /**
   * Send downgrade warning email when usage exceeds new tier limit
   *
   * @param organizationId - Organization UUID
   * @param currentUsage - Current usage count (e.g., SKUs)
   * @param newLimit - New tier limit
   */
  async sendDowngradeWarningEmail(
    organizationId: string,
    currentUsage: number,
    newLimit: number,
  ): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send downgrade warning: SendGrid not configured', { organizationId });
        return;
      }

      // Query organization details
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          users: {
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!organization || !organization.contactEmail || !organization.users[0]) {
        Logger.error('Organization, contact email, or user not found for downgrade warning', {
          organizationId,
        });
        return;
      }

      const userEmail = organization.contactEmail;
      const organizationName = organization.name;
      const excessItems = currentUsage - newLimit;

      const appUrl = envConfig.FRONTEND_URL;
      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
      const msg = {
        to: userEmail,
        subject: 'Usage Limit Exceeded - Downgrade Warning',
        from: fromEmail,
        templateId: TEMPLATE_IDS.downgradeWarning,
        dynamicTemplateData: {
          organizationName,
          currentUsage,
          newLimit,
          excessItems,
          productsUrl: `${appUrl}/products`,
          upgradeUrl: `${appUrl}/upgrade`,
          appUrl,
        },
      };

      await sgMail.send(msg);

      // Log downgrade_warning_sent event
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'downgrade_warning_sent',
          userId: organization.users[0].id,
          changeDescription: `Downgrade warning sent: ${currentUsage} items vs ${newLimit} limit`,
        },
      });

      Logger.info('Downgrade warning email sent', {
        organizationId,
        currentUsage,
        newLimit,
        userEmail,
      });
    } catch (error) {
      Logger.error('Failed to send downgrade warning email', {
        organizationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Sentry.captureException(error, {
        level: 'error',
        tags: { service: 'email-service', event: 'downgrade-warning-email' },
        extra: { organizationId, currentUsage, newLimit, template: 'downgradeWarning' },
      });
      throw error;
    }
  }

  /**
   * Generic email sending method
   */
  async sendEmail(params: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    templateName?: string;
    templateData?: unknown;
  }): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send email: SendGrid not configured', { to: params.to });
        return;
      }

      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
      const msg: Parameters<typeof sgMail.send>[0] = {
        to: params.to,
        from: fromEmail,
        subject: params.subject,
      };

      if (params.html) msg.html = params.html;
      if (params.text) msg.text = params.text;

      await sgMail.send(msg);

      Logger.info('Email sent successfully', {
        to: params.to,
        subject: params.subject,
        templateName: params.templateName,
      });
    } catch (error) {
      Logger.error('Failed to send email', {
        to: params.to,
        subject: params.subject,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send bulk email using SendGrid personalization
   * More efficient than sending individual emails
   */
  async sendBulkEmail(params: {
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    templateId?: string;
    templateData?: unknown;
  }): Promise<void> {
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send bulk email: SendGrid not configured', {
          recipientCount: params.to.length,
        });
        return;
      }

      const fromEmail = envConfig.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';

      const dynamicTemplateData = toTemplateRecord(params.templateData);

      // Create personalizations for each recipient
      const personalizations = params.to.map((email) => ({
        to: [{ email }],
        ...(dynamicTemplateData && {
          dynamicTemplateData,
        }),
      }));

      const msg: BulkEmailPayload = {
        from: fromEmail,
        subject: params.subject,
        personalizations,
      };

      // Add template ID if provided
      if (params.templateId) {
        msg.templateId = params.templateId;
      } else if (params.html || params.text) {
        msg.content = [];
        if (params.html) {
          msg.content.push({ type: 'text/html', value: params.html });
        }
        if (params.text) {
          msg.content.push({ type: 'text/plain', value: params.text });
        }
      }

      await sgMail.send(msg as unknown as Parameters<typeof sgMail.send>[0]);

      Logger.info('Bulk email sent successfully', {
        recipientCount: params.to.length,
        subject: params.subject,
        templateId: params.templateId,
      });
    } catch (error) {
      Logger.error('Failed to send bulk email', {
        recipientCount: params.to.length,
        subject: params.subject,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send payment failed alert email to organization admin
   */
  async sendPaymentFailedEmail(params: {
    organizationId: string;
    paymentIntentId: string;
    errorMessage: string;
  }): Promise<void> {
    const { organizationId, paymentIntentId, errorMessage } = params;
    try {
      if (!envConfig.SENDGRID_API_KEY) {
        Logger.warn('Cannot send payment failed email: SendGrid not configured', {
          organizationId,
        });
        return;
      }

      // Query organization details
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          users: {
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!organization || !organization.contactEmail || !organization.users[0]) {
        Logger.error('Organization, contact email, or user not found for payment failed email', {
          organizationId,
        });
        return;
      }

      const userEmail = organization.contactEmail;
      const organizationName = organization.name;

      const msg = {
        to: userEmail,
        from: envConfig.SENDGRID_FROM_EMAIL || 'noreply@inventorymanager.com',
        subject: `Payment Failed - ${organizationName}`,
        text: `Your payment of $${(2900 / 100).toFixed(2)} could not be processed. Please update your payment method to avoid service interruption.

Error: ${errorMessage}
Payment Intent ID: ${paymentIntentId}

Please update your payment method in your billing settings to continue using the service without interruption.

Thank you,
The Inventory Manager Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Payment Failed</h2>
            <p>Hello,</p>
            <p>We were unable to process your payment of <strong>$${(2900 / 100).toFixed(2)}</strong>.</p>
            <p><strong>Error:</strong> ${errorMessage}</p>
            <p><strong>Payment Intent ID:</strong> ${paymentIntentId}</p>
            <p>Please update your payment method in your billing settings to continue using the service without interruption.</p>
            <p>Thank you,<br>The Inventory Manager Team</p>
          </div>
        `,
      };

      await sgMail.send(msg);

      // Log payment_failed_email_sent event
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'payment_failed_email_sent',
          userId: organization.users[0].id,
          changeDescription: `Payment failed email sent for intent ${paymentIntentId}: ${errorMessage}`,
        },
      });

      Logger.info('Payment failed email sent', {
        organizationId,
        paymentIntentId,
        userEmail,
      });
    } catch (error) {
      Logger.error('Failed to send payment failed email', {
        organizationId,
        paymentIntentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Sentry.captureException(error, {
        level: 'error',
        tags: { service: 'email-service', event: 'payment-failed-email' },
        extra: { organizationId, paymentIntentId, template: 'paymentFailed' },
      });
      throw error;
    }
  }
}

export const emailService = new EmailService();
