/**
 * Webhook Diagnostic Script
 *
 * Diagnostic tool for troubleshooting Stripe webhook issues.
 * Checks processed_webhook_events table, Stripe metadata, and subscription consistency.
 *
 * Usage:
 *   npm run diagnose:webhook -- [--event-id <evt_id>] [--org <org_id>]
 *
 * Options:
 *   --event-id, -e   Specific Stripe event ID to investigate
 *   --org, -o        Organization ID to check webhook health for
 *   --recent, -r     Check recent webhooks (default: last 24 hours)
 *   --verbose, -v    Show detailed output
 *
 * Examples:
 *   npm run diagnose:webhook -- --event-id evt_1234567890
 *   npm run diagnose:webhook -- --org abc-123 --recent
 *   npm run diagnose:webhook -- --verbose
 */

import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import Stripe from 'stripe';
import { envConfig } from '../src/config/environment';

interface DiagnosticOptions {
  eventId?: string;
  orgId?: string;
  recent: boolean;
  verbose: boolean;
}

function parseArguments(): DiagnosticOptions {
  const { values } = parseArgs({
    options: {
      'event-id': { type: 'string', short: 'e' },
      org: { type: 'string', short: 'o' },
      organization: { type: 'string' },
      recent: { type: 'boolean', short: 'r', default: true },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  });

  return {
    eventId: values['event-id'],
    orgId: values.org || values.organization,
    recent: values.recent,
    verbose: values.verbose,
  };
}

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toISOString();
}

function logSection(title: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(title);
  console.log('='.repeat(60));
}

function logSubsection(title: string): void {
  console.log(`\n${'-'.repeat(40)}`);
  console.log(title);
  console.log('-'.repeat(40));
}

function logStatus(status: 'ok' | 'warning' | 'error', message: string): void {
  const icons = { ok: '✅', warning: '⚠️', error: '❌' };
  console.log(`${icons[status]} ${message}`);
}

async function checkWebhookEvent(
  prisma: PrismaClient,
  eventId: string,
  verbose: boolean,
): Promise<void> {
  logSection(`Webhook Event: ${eventId}`);

  const event = await prisma.processedWebhookEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    logStatus('warning', `Event ${eventId} not found in processed_webhook_events table`);
    console.log('\nPossible reasons:');
    console.log('  - Event was never received (check Stripe dashboard)');
    console.log('  - Event processing failed before being marked as processed');
    console.log('  - Event ID is incorrect');
    console.log('\nNext steps:');
    console.log('  1. Verify event ID in Stripe dashboard');
    console.log('  2. Check application logs for error during event processing');
    console.log('  3. If event failed permanently, replay via Stripe CLI:');
    console.log(`     stripe events resend ${eventId}`);
    return;
  }

  logStatus('ok', `Event found in database`);
  console.log(`  Event Type: ${event.eventType}`);
  console.log(`  Processed At: ${formatDate(event.processedAt)}`);
  console.log(`  Created At: ${formatDate(event.createdAt)}`);

  if (verbose) {
    logSubsection('Event Record Details');
    console.log(JSON.stringify(event, null, 2));
  }

  // Check if event was recent
  const hoursAgo = (Date.now() - event.processedAt.getTime()) / (1000 * 60 * 60);
  if (hoursAgo > 24) {
    logStatus('warning', `Event processed ${hoursAgo.toFixed(1)} hours ago (older than 24h)`);
  }
}

async function checkOrganizationWebhooks(
  prisma: PrismaClient,
  orgId: string,
  verbose: boolean,
): Promise<void> {
  logSection(`Organization Webhook Health: ${orgId}`);

  // Check organization exists
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      subscriptionTiers: { orderBy: { createdAt: 'desc' }, take: 1 },
      organizationUsages: true,
    },
  });

  if (!org) {
    logStatus('error', `Organization ${orgId} not found`);
    return;
  }

  logStatus('ok', `Organization found: ${org.name}`);

  // Check subscription
  const subscription = org.subscriptionTiers[0];
  if (!subscription) {
    logStatus('error', 'No subscription found for organization');
    console.log('\nThis indicates a serious configuration issue.');
    console.log('Every organization should have at least a Starter subscription.');
  } else {
    logStatus('ok', `Subscription found: ${subscription.tierLevel} (${subscription.status})`);
    console.log(`  Stripe Subscription ID: ${subscription.stripeSubscriptionId || 'N/A'}`);
    console.log(`  Current Period End: ${formatDate(subscription.currentPeriodEnd)}`);
  }

  // Check recent webhook events for this org
  logSubsection('Recent Webhook Events');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  const recentEvents = await prisma.processedWebhookEvent.findMany({
    where: {
      processedAt: { gte: since },
    },
    orderBy: { processedAt: 'desc' },
    take: 10,
  });

  if (recentEvents.length === 0) {
    logStatus('warning', 'No webhook events found in last 24 hours');
    console.log('\nPossible reasons:');
    console.log('  - Webhook endpoint not configured in Stripe');
    console.log('  - Webhook secret incorrect (signature verification failing)');
    console.log('  - No subscription activity (no events to send)');
    console.log('\nNext steps:');
    console.log('  1. Verify webhook URL in Stripe dashboard');
    console.log('  2. Check STRIPE_WEBHOOK_SECRET environment variable');
    console.log('  3. Test webhook delivery with Stripe CLI:');
    console.log('     stripe trigger customer.subscription.created');
  } else {
    logStatus('ok', `${recentEvents.length} webhook events in last 24 hours`);
    if (verbose) {
      recentEvents.forEach((evt) => {
        console.log(`  - ${evt.eventType} at ${formatDate(evt.processedAt)} (${evt.id})`);
      });
    }
  }

  // Check for failed events (if we had a failure tracking table)
  // Note: This would require a webhook_failure_log table which doesn't exist yet
  // For now, we rely on Sentry and application logs

  // Check Stripe metadata (requires Stripe API)
  if (envConfig.STRIPE_SECRET_KEY && subscription?.stripeSubscriptionId) {
    logSubsection('Stripe Metadata Verification');
    const stripe = new Stripe(envConfig.STRIPE_SECRET_KEY, {
      apiVersion: '2023-08-16',
    });

    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      const customerId =
        typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id;
      const customer = await stripe.customers.retrieve(customerId);

      if (customer.deleted) {
        logStatus('error', 'Stripe customer has been deleted');
      } else {
        const metadataOrgId = customer.metadata?.organizationId;
        if (!metadataOrgId) {
          logStatus('error', 'Missing organizationId in Stripe customer metadata');
          console.log('\nThis is CRITICAL - webhook handlers require this metadata');
          console.log('Update Stripe customer:');
          console.log(
            `  stripe customers update ${customerId} -d "metadata[organizationId]=${orgId}"`,
          );
        } else if (metadataOrgId !== orgId) {
          logStatus('error', `Metadata mismatch: Stripe has ${metadataOrgId}, expected ${orgId}`);
        } else {
          logStatus('ok', 'Stripe customer metadata organizationId matches');
        }
      }
    } catch (error) {
      logStatus('error', `Failed to verify Stripe metadata: ${(error as Error).message}`);
    }
  }
}

async function checkRecentWebhookHealth(prisma: PrismaClient, verbose: boolean): Promise<void> {
  logSection('Recent Webhook Health (Last 24 Hours)');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get event counts by type
  const eventsByType = await prisma.processedWebhookEvent.groupBy({
    by: ['eventType'],
    where: { processedAt: { gte: since } },
    _count: { id: true },
  });

  if (eventsByType.length === 0) {
    logStatus('warning', 'No webhook events processed in last 24 hours');
    return;
  }

  logStatus(
    'ok',
    `Webhook events processed: ${eventsByType.reduce((sum, e) => sum + e._count.id, 0)}`,
  );

  console.log('\nEvents by type:');
  eventsByType.forEach((evt) => {
    console.log(`  ${evt.eventType}: ${evt._count.id}`);
  });

  // Check for potential issues
  logSubsection('Potential Issues');

  // Check for duplicate events
  const potentialDuplicates = await prisma.processedWebhookEvent.findMany({
    where: { processedAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });

  const seenEventIds = new Set<string>();
  const duplicates: string[] = [];
  potentialDuplicates.forEach((evt) => {
    if (seenEventIds.has(evt.id)) {
      duplicates.push(evt.id);
    } else {
      seenEventIds.add(evt.id);
    }
  });

  if (duplicates.length > 0) {
    logStatus('warning', `${duplicates.length} potential duplicate events detected`);
    if (verbose) {
      duplicates.forEach((id) => console.log(`  - ${id}`));
    }
  } else {
    logStatus('ok', 'No duplicate events detected');
  }
}

async function printTroubleshootingGuide(): Promise<void> {
  logSection('Quick Troubleshooting Guide');

  console.log('\n1. Signature Verification Failed');
  console.log('   Cause: STRIPE_WEBHOOK_SECRET mismatch');
  console.log('   Fix: Copy correct secret from Stripe dashboard → Developers → Webhooks');

  console.log('\n2. Missing organizationId in Metadata');
  console.log('   Cause: Stripe customer.metadata.organizationId not set');
  console.log(
    '   Fix: stripe customers update <customer_id> -d "metadata[organizationId]=<org_id>"',
  );

  console.log('\n3. Organization Not Found');
  console.log('   Cause: Metadata has wrong organizationId or org was deleted');
  console.log('   Fix: Update Stripe metadata or recreate organization');

  console.log('\n4. Duplicate Events');
  console.log('   Cause: Idempotency check bypassed or race condition');
  console.log('   Fix: Check processed_webhook_events table for existing event ID');

  console.log('\n5. No Events Being Received');
  console.log('   Cause: Webhook endpoint misconfigured or application down');
  console.log('   Fix: Verify endpoint URL in Stripe, check application health');

  console.log('\nUseful Commands:');
  console.log('  stripe listen --forward-to localhost:3001/api/webhooks/stripe');
  console.log('  stripe trigger customer.subscription.created');
  console.log('  stripe events list --limit 10');
}

async function runDiagnostics(): Promise<void> {
  const options = parseArguments();
  const prisma = new PrismaClient();

  console.log('🔍 Stripe Webhook Diagnostic Tool');
  console.log('==================================');

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    logStatus('ok', 'Database connection successful');

    // Check environment
    if (!envConfig.STRIPE_SECRET_KEY) {
      logStatus('warning', 'STRIPE_SECRET_KEY not configured - Stripe API checks disabled');
    } else {
      logStatus('ok', 'STRIPE_SECRET_KEY configured');
    }

    if (!envConfig.STRIPE_WEBHOOK_SECRET) {
      logStatus('warning', 'STRIPE_WEBHOOK_SECRET not configured');
    } else {
      logStatus('ok', 'STRIPE_WEBHOOK_SECRET configured');
    }

    // Run specific checks based on arguments
    if (options.eventId) {
      await checkWebhookEvent(prisma, options.eventId, options.verbose);
    }

    if (options.orgId) {
      await checkOrganizationWebhooks(prisma, options.orgId, options.verbose);
    }

    if (options.recent && !options.eventId && !options.orgId) {
      await checkRecentWebhookHealth(prisma, options.verbose);
    }

    // Always print guide at end
    await printTroubleshootingGuide();
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', (error as Error).message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDiagnostics();
