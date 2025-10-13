import { Router, Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { authenticateToken, generateToken } from "../middleware/auth.middleware";

const router = Router();
const authService = new AuthService();

router.post("/login", async (req: Request, res: Response) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ message: "PIN is required" });
  }

  // Validate PIN strength
  const pinValidation = authService.validatePin(pin);
  if (!pinValidation.isValid) {
    return res.status(400).json({ message: pinValidation.message });
  }

  try {
    // For this implementation, we're using direct PIN comparison.
    // In a real application, you would properly compare hashes
    const token = await authService.login(pin);
    if (token) {
      res.json({ token });
    } else {
      res.status(401).json({ message: "Invalid PIN" });
    }
  } catch (_error) {
    // console.error("Login error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Token refresh endpoint
router.post("/refresh", authenticateToken, async (req: Request, res: Response) => {
  try {
    // Regenerate token with updated expiration
    const { userId, userRole } = (req as any); // Using 'any' to access custom properties added by auth middleware
    
    if (!userId || !userRole) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const newToken = generateToken(userId, userRole, '1h');
    res.json({ token: newToken });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
