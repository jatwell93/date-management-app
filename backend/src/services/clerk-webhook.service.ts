/**
 * Clerk Webhook Handler Service
 *
 * Implements Clerk webhook verification and processing with idempotent handling.
 * Handles user.created, user.updated, and organization.created events.
 *
 * Handler sequence (required):
 * 1. Verify signature first (reject invalid with 4xx)
 * 2. Parse payload second (after verification)
 * 3. Handle idempotently (check event ID, process, store)
 */

import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { envConfig } from '../config/environment';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SubscriptionService } from './subscription.service';
import { Webhook } from 'svix';
import * as Sentry from '@sentry/node';
import { ApplicationMonitoringService } from './application.monitoring.service';

// Simple logging utility
const log = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[CLERK_WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[CLERK_WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(`[CLERK_WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
};

export class ClerkWebhookService {
  private prisma: PrismaClient;
  private subscriptionService: SubscriptionService;
  private monitor: ApplicationMonitoringService;

  constructor(prismaClient?: PrismaClient, subscriptionService?: SubscriptionService) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.subscriptionService = subscriptionService ?? new SubscriptionService(this.prisma);
    this.monitor = ApplicationMonitoringService.getInstance();
  }

  /**
   * Verify Clerk webhook signature using Svix
   */
  verifySignature(payload: Buffer, headers: Record<string, string>): unknown {
    if (!envConfig.CLERK_WEBHOOK_SECRET) {
      throw new Error('CLERK_WEBHOOK_SECRET is not configured');
    }

    const wh = new Webhook(envConfig.CLERK_WEBHOOK_SECRET);

    // Get the svix-specific headers
    const svixId = headers['svix-id'];
    const svixTimestamp = headers['svix-timestamp'];
    const svixSignature = headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new Error('Missing required Svix headers');
    }

    // Verify the webhook
    return wh.verify(payload.toString(), {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  }

  /**
   * Check if this is a new event (idempotency check)
   */
  async isNewEvent(eventId: string): Promise<boolean> {
    try {
      const existingEvent = await this.prisma.clerkWebhookEvent.findUnique({
        where: { id: eventId },
      });
      return !existingEvent;
    } catch (error) {
      log.error('Error checking webhook event idempotency', { eventId, error });
      // If we can't check, assume it's new to avoid missing events
      return true;
    }
  }

  /**
   * Mark an event as processed
   */
  async markEventProcessed(eventId: string, eventType: string): Promise<void> {
    try {
      await this.prisma.clerkWebhookEvent.create({
        data: {
          id: eventId,
          eventType,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      log.error('Error marking webhook event as processed', { eventId, eventType, error });
      // Don't throw - this is cleanup, the main event already succeeded
    }
  }

  /**
   * Handle the webhook event
   */
  async handleEvent(event: any): Promise<void> {
    const { type, data } = event;

    switch (type) {
      case 'user.created':
        await this.handleUserCreated(data);
        break;
      case 'user.updated':
        await this.handleUserUpdated(data);
        break;
      case 'organization.created':
        await this.handleOrganizationCreated(data);
        break;
      case 'organizationMembership.created':
        await this.handleOrganizationMembershipCreated(data);
        break;
      case 'organizationMembership.deleted':
        await this.handleOrganizationMembershipDeleted(data);
        break;
      default:
        log.info('Unhandled webhook event type', { type });
        break;
    }
  }

  /**
   * Handle user.created event
   * Creates a user record and organization if needed
   */
  private async handleUserCreated(data: any): Promise<void> {
    const { id, email_addresses, username, first_name, last_name, organization_memberships } = data;

    try {
      // Get primary email
      const primaryEmail = email_addresses.find(
        (email: any) => email.id === data.primary_email_address_id,
      )?.email_address;

      if (!primaryEmail) {
        log.error('User created event missing primary email', { userId: id });
        return;
      }

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { clerkUserId: id },
      });

      if (existingUser) {
        log.info('User already exists, skipping creation', { clerkUserId: id });
        return;
      }

      // Get organization membership if user belongs to an org
      const orgMembership = organization_memberships?.[0];
      let organizationId: string | null = null;

      if (orgMembership?.organization) {
        // Find or create organization from Clerk
        const org = await this.findOrCreateOrganization(orgMembership.organization);
        organizationId = org.id;
      } else {
        // Auto-create organization for email/password signups
        const org = await this.createDefaultOrganization(id, primaryEmail);
        organizationId = org.id;
      }

      // Create user
      const user = await this.prisma.user.create({
        data: {
          clerkUserId: id,
          email: primaryEmail,
          username: username || primaryEmail.split('@')[0],
          organizationId,
          role: orgMembership?.role === 'admin' ? 'Manager' : 'Team Member',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      log.info('User created successfully', {
        userId: user.id,
        clerkUserId: id,
        email: primaryEmail,
        organizationId,
      });

      // Create trial subscription for the organization
      await this.ensureTrialSubscription(organizationId, primaryEmail);
    } catch (error) {
      log.error('Error handling user.created event', { userId: id, error });
      Sentry.captureException(error, { extra: { userId: id, eventType: 'user.created' } });
      throw error;
    }
  }

  /**
   * Handle user.updated event
   */
  private async handleUserUpdated(data: any): Promise<void> {
    const { id, email_addresses, username, first_name, last_name } = data;

    try {
      // Get primary email
      const primaryEmail = email_addresses.find(
        (email: any) => email.id === data.primary_email_address_id,
      )?.email_address;

      // Update user record
      await this.prisma.user.updateMany({
        where: { clerkUserId: id },
        data: {
          email: primaryEmail,
          username: username || primaryEmail?.split('@')[0],
          updatedAt: new Date(),
        },
      });

      log.info('User updated successfully', { clerkUserId: id, email: primaryEmail });
    } catch (error) {
      log.error('Error handling user.updated event', { userId: id, error });
      Sentry.captureException(error, { extra: { userId: id, eventType: 'user.updated' } });
      throw error;
    }
  }

  /**
   * Handle organization.created event
   */
  private async handleOrganizationCreated(data: any): Promise<void> {
    const { id, name, created_by } = data;

    try {
      // Find or create organization
      const org = await this.findOrCreateOrganization({
        id,
        name,
        created_by,
      });

      log.info('Organization created/updated successfully', {
        organizationId: org.id,
        clerkOrganizationId: id,
        name,
      });
    } catch (error) {
      log.error('Error handling organization.created event', { organizationId: id, error });
      Sentry.captureException(error, {
        extra: { organizationId: id, eventType: 'organization.created' },
      });
      throw error;
    }
  }

  /**
   * Handle organizationMembership.created event
   * Links an existing user to an organization when they join
   */
  private async handleOrganizationMembershipCreated(data: any): Promise<void> {
    const { public_user_data, organization, role } = data;
    const clerkUserId = public_user_data?.user_id;
    const clerkOrgId = organization?.id;

    try {
      if (!clerkUserId || !clerkOrgId) {
        log.error('organizationMembership.created missing user or org id', { data });
        return;
      }

      // Find or create the organization
      const org = await this.findOrCreateOrganization(organization);

      // Map Clerk role to app role
      const appRole = role === 'org:admin' ? 'Manager' : 'Team Member';

      // Link user to organization
      const updated = await this.prisma.user.updateMany({
        where: { clerkUserId },
        data: {
          organizationId: org.id,
          role: appRole,
          updatedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        log.warn('organizationMembership.created: no user found to update', { clerkUserId });
      } else {
        log.info('User linked to organization', {
          clerkUserId,
          organizationId: org.id,
          role: appRole,
        });
      }

      // Ensure trial subscription exists for the organization
      const user = await this.prisma.user.findFirst({
        where: { clerkUserId },
        select: { email: true },
      });
      await this.ensureTrialSubscription(org.id, user?.email ?? '');
    } catch (error) {
      log.error('Error handling organizationMembership.created', {
        clerkUserId,
        clerkOrgId,
        error,
      });
      Sentry.captureException(error, {
        extra: { clerkUserId, clerkOrgId, eventType: 'organizationMembership.created' },
      });
      throw error;
    }
  }

  /**
   * Handle organizationMembership.deleted event
   * Unlinks a user from an organization when they leave/are removed
   */
  private async handleOrganizationMembershipDeleted(data: any): Promise<void> {
    const { public_user_data, organization } = data;
    const clerkUserId = public_user_data?.user_id;
    const clerkOrgId = organization?.id;

    try {
      if (!clerkUserId) {
        log.error('organizationMembership.deleted missing user id', { data });
        return;
      }

      // Soft delete user when removed from organization (preserve audit history)
      // First find the organization by clerkOrganizationId
      const org = await this.prisma.organization.findUnique({
        where: { clerkOrganizationId: clerkOrgId },
        select: { id: true },
      });

      if (!org) {
        log.error('Organization not found for clerk org id', { clerkOrgId });
        return;
      }

      // Now update user directly using organizationId
      // Find the user first to get their ID
      const user = await this.prisma.user.findFirst({
        where: { clerkUserId, organizationId: org.id },
      });

      if (!user) {
        log.warn('User not found for soft delete', { clerkUserId, organizationId: org.id });
        return;
      }

      // Soft delete the user using update (not updateMany) to trigger foreign key constraints
      await this.prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date() },
      });

      log.info('User unlinked from organization', { clerkUserId, clerkOrgId });
    } catch (error) {
      log.error('Error handling organizationMembership.deleted', {
        clerkUserId,
        clerkOrgId,
        error,
      });
      Sentry.captureException(error, {
        extra: { clerkUserId, clerkOrgId, eventType: 'organizationMembership.deleted' },
      });
      throw error;
    }
  }

  /**
   * Find or create organization based on Clerk data
   */
  private async findOrCreateOrganization(clerkOrg: any): Promise<{ id: string }> {
    // Check if organization already exists
    let org = await this.prisma.organization.findUnique({
      where: { clerkOrganizationId: clerkOrg.id },
    });

    if (!org) {
      // Create new organization
      org = await this.prisma.organization.create({
        data: {
          clerkOrganizationId: clerkOrg.id,
          name: clerkOrg.name || 'Default Organization',
          slug: (clerkOrg.slug || clerkOrg.name || clerkOrg.id)
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    return org;
  }

  /**
   * Create default organization for new email/password signups
   */
  private async createDefaultOrganization(
    clerkUserId: string,
    email: string,
  ): Promise<{ id: string }> {
    const orgName = email.split('@')[0] + "'s Organization";
    const slug = `${email.split('@')[0]}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const org = await this.prisma.organization.create({
      data: {
        name: orgName,
        slug: slug,
        contactEmail: email,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    log.info('Created default organization for new user', {
      organizationId: org.id,
      clerkUserId,
      email,
    });

    return org;
  }

  /**
   * Ensure trial subscription exists for organization
   * Implements 90-day trial abuse prevention (16A.C.3)
   */
  private async ensureTrialSubscription(organizationId: string, email: string): Promise<void> {
    try {
      // Check if subscription already exists
      const existingSubscription = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (existingSubscription) {
        log.info('Subscription already exists for organization', { organizationId });
        return;
      }

      // Trial abuse prevention: Check if email was used for trial in last 90 days (16A.C.3)
      // Only block if the previous trial is still active or expired less than 30 days ago
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const recentTrialUser = await this.prisma.user.findFirst({
        where: {
          email,
          createdAt: { gte: ninetyDaysAgo },
          organization: {
            subscriptionTiers: {
              some: {
                status: 'trialing',
                // Allow if trial ended more than 30 days ago
                OR: [
                  { trialEndDate: { gte: new Date() } }, // Still trialing
                  { trialEndDate: { gte: thirtyDaysAgo } }, // Trial ended recently
                ],
              },
            },
          },
        },
        include: { organization: { include: { subscriptionTiers: true } } },
      });

      if (recentTrialUser) {
        log.warn('Trial abuse detected: email used for trial in last 90 days', {
          email,
          existingUserId: recentTrialUser.id,
          organizationId: recentTrialUser.organizationId,
        });
        Sentry.captureMessage('Trial abuse attempt blocked', {
          level: 'warning',
          extra: {
            email,
            existingUserId: recentTrialUser.id,
            existingOrgId: recentTrialUser.organizationId,
            newOrgId: organizationId,
          },
        });
        // Skip trial creation - user must pay for subscription
        return;
      }

      // Create trial subscription
      await this.subscriptionService.createTrialSubscription(organizationId, 14);

      log.info('Trial subscription created', { organizationId, email });
    } catch (error) {
      log.error('Error creating trial subscription', { organizationId, error });
      // Don't throw - user is created, we can retry subscription later
    }
  }

  /**
   * Send success response
   */
  sendSuccess(res: Response): void {
    res.status(200).json({ received: true });
  }

  /**
   * Send error response
   */
  sendError(res: Response, message: string, statusCode: number = 400): void {
    res.status(statusCode).json({ error: message });
  }
}

// Export singleton instance
export const clerkWebhookService = new ClerkWebhookService();
