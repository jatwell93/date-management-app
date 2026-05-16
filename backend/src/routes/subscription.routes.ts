import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { clerkAuth } from '../middleware/clerk-auth.middleware';
import { trialConversionLimiter, checkoutSessionLimiter } from '../middleware/rateLimiter';
import { createSubscriptionController } from '../di/services';

const router = Router();

router.get(
  '/trial-status',
  clerkAuth as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const controller = createSubscriptionController();
      await controller.getTrialStatus(req, res);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/convert-trial',
  trialConversionLimiter,
  clerkAuth as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const controller = createSubscriptionController();
      await controller.convertTrial(req, res);
    } catch (error) {
      next(error);
    }
  },
);

// Create Stripe Checkout Session for subscription upgrade
router.post(
  '/create-checkout-session',
  checkoutSessionLimiter,
  clerkAuth as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const controller = createSubscriptionController();
      await controller.createCheckoutSession(req, res);
    } catch (error) {
      next(error);
    }
  },
);

// Create Stripe Customer Portal Session for billing management
router.post(
  '/create-portal-session',
  clerkAuth as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const controller = createSubscriptionController();
      await controller.createPortalSession(req, res);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
