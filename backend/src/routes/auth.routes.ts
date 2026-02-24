import { Router, Request, Response, RequestHandler } from 'express';
import { clerkAuth } from '../middleware/clerk-auth.middleware';

const router = Router();

// POST /auth/logout
// Clerk manages session invalidation client-side (clear the JWT).
// This endpoint exists for clients that want a server-side logout acknowledgement.
router.post('/logout', clerkAuth as unknown as RequestHandler, (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Logged out successfully' });
});

export default router;
