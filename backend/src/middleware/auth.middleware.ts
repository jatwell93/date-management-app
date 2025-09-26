import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) return res.sendStatus(401); // No token

  interface JwtPayload {
    userId: number;
    role: string;
  }

  jwt.verify(
    token,
    "your_jwt_secret",
    (err: jwt.VerifyErrors | null, user: JwtPayload | undefined) => {
      if (err) return res.sendStatus(403); // Invalid token
      req.userId = user.userId;
      req.userRole = user.role;
      next();
    },
  );
};

export const requireManager = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.userRole !== "Manager") {
    return res
      .status(403)
      .json({ message: "Access denied: Manager role required" });
  }
  next();
};
