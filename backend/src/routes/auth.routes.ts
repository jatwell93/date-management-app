import { Router, Request, Response, NextFunction } from 'express';
import validator from 'validator';
import { AuthService } from '../services/auth.service';
import { authenticateToken, generateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { loginSchema } from '../schemas';
import { strictLimiter } from '../middleware/rateLimiter';
import { AuthenticationError } from '../errors';

const router = Router();
const authService = new AuthService();

const normalizePin = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body?.pin !== undefined && req.body?.pin !== null) {
    req.body.pin = String(req.body.pin);
  }
  next();
};

router.post(
  '/login',
  strictLimiter,
  normalizePin,
  validateRequest(loginSchema),
  async (req: Request, res: Response) => {
    const rawPin = req.body.pin as string | undefined;
    const pin = rawPin ? validator.whitelist(rawPin, '0-9') : '';
    if (!pin) {
      return res.status(400).json({ message: 'PIN is required' });
    }

    if (rawPin && pin !== rawPin) {
      return res.status(400).json({ message: 'PIN must contain only digits' });
    }

    // Validate PIN strength
    const pinValidation = authService.validatePin(pin);
    if (!pinValidation.isValid) {
      return res.status(400).json({ message: pinValidation.message });
    }

    try {
      // For this implementation, we're using direct PIN comparison.
      // In a real application, you would properly compare hashes
      const authResult = await authService.login(pin);
      res.json(authResult);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return res.status(401).json({ message: error.message });
      }
      // console.error("Login error:", error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// Token refresh endpoint
router.post('/refresh', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Regenerate token with updated expiration
    const authReq = req as any; // Using 'any' to access custom properties added by auth middleware

    if (!authReq.userId || !authReq.userRole || !authReq.organizationId || !authReq.tierLevel) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const newToken = generateToken(authReq.userId, authReq.userRole, authReq.organizationId, authReq.tierLevel, '1h');
    res.json({ token: newToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
