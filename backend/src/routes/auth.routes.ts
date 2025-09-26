import { Router, Request, Response } from "express";
import { AuthService } from "../services/auth.service";

const router = Router();
const authService = new AuthService();

router.post("/login", async (req: Request, res: Response) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ message: "PIN is required" });
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

export default router;
