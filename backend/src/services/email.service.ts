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

const TEMPLATE_IDS = {
  trialEndingSoon: 'd-916668c6137341c292fad8cf219cb0ee',
  paymentFailed: 'd-731aef13fcd5415095708633599d37b6',
  downgradeWarning: 'd-a4639fceab7747d798b1931b955163e2',
};

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
      throw error;
    }
  }
}

export const emailService = new EmailService();
