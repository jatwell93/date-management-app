import { Request, Response, NextFunction } from "express";

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
  
  // Use 500 as default status code if not already set
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    message: err.message,
    // Only send stack trace in development environment
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};
