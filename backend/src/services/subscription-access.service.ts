import Stripe from 'stripe';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { SubscriptionStatus } from '../types/subscription';
import { Logger } from '../utils/logger';
import { hasActiveStripeAccessWindow } from './subscription-access.helpers';

export class SubscriptionAccessService {
  constructor(private readonly stripe: Stripe) {}

  async isAccessActive(subscriptionTier: SubscriptionTier): Promise<boolean> {
    if (subscriptionTier.status !== SubscriptionStatus.CANCELED) {
      return true;
    }

    if (!subscriptionTier.stripeSubscriptionId) {
      return false;
    }

    try {
      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscriptionTier.stripeSubscriptionId,
      );

      return hasActiveStripeAccessWindow(stripeSubscription);
    } catch (error) {
      Logger.warn('Failed to verify Stripe access window', {
        organizationId: subscriptionTier.organizationId,
        stripeSubscriptionId: subscriptionTier.stripeSubscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}
