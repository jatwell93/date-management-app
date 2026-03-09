/**
 * Stripe Utility Module
 *
 * Provides singleton Stripe instance with validation
 * Ensures STRIPE_SECRET_KEY is validated at startup
 */

import Stripe from 'stripe';
import { envConfig } from '../config/environment';

let stripeInstance: Stripe | null = null;

/**
 * Validate Stripe configuration
 * Throws error if STRIPE_SECRET_KEY is missing or invalid
 */
function validateStripeConfig(): void {
  if (!envConfig.STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured. Please set it in your environment variables.',
    );
  }

  if (!envConfig.STRIPE_SECRET_KEY.startsWith('sk_')) {
    throw new Error('STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_".');
  }
}

/**
 * Get the singleton Stripe instance
 * Creates the instance on first call with validation
 */
export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    validateStripeConfig();

    const stripeSecretKey = envConfig.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY is not configured. Please set it in your environment variables.',
      );
    }

    stripeInstance = new Stripe(stripeSecretKey, {
      apiVersion: '2023-08-16',
      typescript: true,
    });
  }

  return stripeInstance;
}

/**
 * Reset the Stripe instance (useful for testing)
 */
export function resetStripeClient(): void {
  stripeInstance = null;
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!envConfig.STRIPE_SECRET_KEY && envConfig.STRIPE_SECRET_KEY.startsWith('sk_');
}
