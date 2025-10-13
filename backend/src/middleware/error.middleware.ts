import { Request, Response, NextFunction } from "express";
import { Logger } from "../utils/logger";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Prevent multiple responses
  if (res.headersSent) {
    return _next(err);
  }
  
  // Log the error with additional context
  Logger.error(`Request Error: ${err.message}`, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    stack: err.stack,
  });
  
  // Use 500 as default status code if not already set
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    message: err.message,
    // Only send stack trace in development environment
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};
