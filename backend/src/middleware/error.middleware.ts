import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode; // Default to 500 if no status code is set

  const statusCode = res.statusCode === 200 ? 500 : res.statusCode; // Default to 500 if no status code is set
  res.status(statusCode).json({
    message: err.message,
    // Only send stack trace in development environment
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};
