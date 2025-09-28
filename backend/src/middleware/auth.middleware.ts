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

  if (token == null) return res.status(401).json({ message: "Access denied: No token provided" }); // No token

  // The 'user' object from the callback can be of type `jwt.JwtPayload`
  // which can include standard claims, or it can be a string.
  // We'll define a type for our specific payload structure.
  interface CustomPayload extends jwt.JwtPayload {
    userId: number;
    role: string;
  }

  jwt.verify(
    token,
    "your_jwt_secret", // It's better to use an environment variable here, e.g., process.env.JWT_SECRET
    (err, user) => { // Let TypeScript infer the type of `user`
      if (err) {
        return res.status(403).json({ message: "Access denied: Invalid token" }); // Token is invalid (e.g., expired, wrong signature)
      }
      
      // FIX: Add a check to ensure the user payload exists and is an object
      if (!user || typeof user === 'string') {
        return res.status(403).json({ message: "Access denied: Invalid token payload" }); // Token is valid, but payload is missing or in wrong format
      }

      // Now that we've checked, we can safely access the properties
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
