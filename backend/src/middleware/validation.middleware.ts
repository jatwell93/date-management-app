import { Request, Response, NextFunction } from 'express';
import path from 'path';
import validator from 'validator';

// Validation middleware for product creation
export const validateProductInput = (req: Request, res: Response, next: NextFunction) => {
  const { barcode, sku, name, cost_price } = req.body;

  // Validate barcode (alphanumeric, 8-14 characters typically for UPC/EAN)
  if (
    barcode &&
    (!validator.isAlphanumeric(barcode.replace(/-/g, '')) ||
      barcode.length < 8 ||
      barcode.length > 14)
  ) {
    return res.status(400).json({ error: 'Invalid barcode format' });
  }

  // Validate SKU (alphanumeric and hyphens, up to 50 characters)
  if (sku && (!validator.isAlphanumeric(sku.replace(/-/g, '')) || sku.length > 50)) {
    return res.status(400).json({ error: 'Invalid SKU format' });
  }

  // Validate name (no HTML tags, max 200 characters)
  if (
    name &&
    (validator.contains(name, '<') || validator.contains(name, '>') || name.length > 200)
  ) {
    return res.status(400).json({ error: 'Invalid product name format' });
  }

  // Validate cost price (positive number)
  if (
    cost_price !== undefined &&
    (!validator.isNumeric(String(cost_price)) || parseFloat(cost_price) < 0)
  ) {
    return res.status(400).json({ error: 'Cost price must be a positive number' });
  }

  // Additional validation: Check if cost_price is a reasonable value (under $10000 for example)
  if (cost_price !== undefined && parseFloat(cost_price) > 10000) {
    return res
      .status(400)
      .json({ error: 'Cost price seems unusually high. Please verify the value.' });
  }

  next();
};

// Validation middleware for inventory item creation
export const validateInventoryItemInput = (req: Request, res: Response, next: NextFunction) => {
  const { expiry_date, product_id, location_id, status } = req.body;

  // Validate expiry date (YYYY-MM-DD format)
  if (expiry_date && !validator.isISO8601(expiry_date, { strict: true })) {
    return res.status(400).json({ error: 'Invalid expiry date format. Use YYYY-MM-DD.' });
  }

  // Validate that expiry date is not in the past
  if (expiry_date) {
    // Create date objects for today and expiry date at the start of the day in local timezone
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today in local time

    const expiry = new Date(expiry_date);
    expiry.setHours(0, 0, 0, 0); // Start of expiry day in local time

    if (expiry < today) {
      return res.status(400).json({ error: 'Expiry date cannot be in the past.' });
    }
  }

  // Validate product_id (positive integer)
  if (
    product_id !== undefined &&
    (!validator.isInt(String(product_id), { min: 1 }) || parseInt(product_id, 10) <= 0)
  ) {
    return res.status(400).json({ error: 'Product ID must be a positive integer' });
  }

  // Validate location_id (positive integer)
  if (
    location_id &&
    (!validator.isInt(String(location_id), { min: 1 }) || parseInt(location_id, 10) <= 0)
  ) {
    return res.status(400).json({ error: 'Location ID must be a positive integer' });
  }

  // Validate status if provided
  if (
    status &&
    ![
      'Normal',
      'Near Expiry',
      'Expired',
      'Damaged',
      'Markdown 1',
      'Markdown 2',
      'Markdown 3',
    ].includes(status)
  ) {
    return res.status(400).json({
      error:
        'Invalid status. Must be one of: Normal, Near Expiry, Expired, Damaged, Markdown 1, Markdown 2, Markdown 3',
    });
  }

  next();
};

// Validation middleware for user creation
export const validateUserInput = (req: Request, res: Response, next: NextFunction) => {
  const { pin, role } = req.body;

  // Validate PIN (4-6 digits)
  if (pin && (!validator.isNumeric(pin) || pin.length < 4 || pin.length > 6)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }

  // Validate role
  if (role && !['Manager', 'Team Member'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either "Manager" or "Team Member"' });
  }

  next();
};

// Validation middleware for store areas
export const validateStoreAreaInput = (req: Request, res: Response, next: NextFunction) => {
  const { name, sub_department } = req.body;

  // Validate name (no HTML tags, max 100 characters)
  if (
    name &&
    (validator.contains(name, '<') || validator.contains(name, '>') || name.length > 100)
  ) {
    return res.status(400).json({ error: 'Invalid store area name format' });
  }

  // Validate sub_department if provided (no HTML tags, max 50 characters)
  if (
    sub_department &&
    (validator.contains(sub_department, '<') ||
      validator.contains(sub_department, '>') ||
      sub_department.length > 50)
  ) {
    return res.status(400).json({ error: 'Invalid sub-department format' });
  }

  next();
};

// Additional validation middleware for data integrity checks
export const validateDataIntegrity = (req: Request, res: Response, next: NextFunction) => {
  // Check request size to prevent oversized payloads
  const contentLength = req.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
    // 10MB limit
    return res
      .status(413)
      .json({ error: 'Request payload too large. Maximum allowed size is 10MB.' });
  }

  // Check for potential SQL injection patterns in string fields
  for (const key in req.body) {
    const value = req.body[key];
    if (typeof value === 'string') {
      // Check for common SQL injection patterns
      const sqlInjectionPatterns = [
        /(\b(union|select|insert|delete|update|drop|create|alter|exec|execute)\b)/i,
        /(;|--|\/\*|\*\/|xp_|sp_|0x)/i,
      ];

      for (const pattern of sqlInjectionPatterns) {
        if (pattern.test(value)) {
          return res.status(400).json({ error: 'Invalid input detected' });
        }
      }
    }
  }

  next();
};

// Validation middleware for database backup restore
export const validateBackupRestoreInput = (req: Request, res: Response, next: NextFunction) => {
  const { backupPath } = req.body;

  if (!backupPath || typeof backupPath !== 'string') {
    return res.status(400).json({ error: 'Backup path is required' });
  }

  const normalizedPath = path.normalize(backupPath);
  if (normalizedPath.includes('..')) {
    return res.status(400).json({ error: 'Invalid backup path' });
  }

  const baseDir = path.resolve('backups');
  const resolvedPath = path.resolve(backupPath);
  if (!resolvedPath.startsWith(baseDir + path.sep)) {
    return res.status(400).json({ error: 'Backup path must be within backups directory' });
  }

  next();
};

// Validation middleware for inventory transactions
export const validateInventoryTransactionInput = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { inventory_item_id, user_id, type, quantity_change, notes } = req.body;

  if (!validator.isInt(String(inventory_item_id), { min: 1 })) {
    return res.status(400).json({ error: 'Inventory item id must be a positive integer' });
  }

  if (!validator.isInt(String(user_id), { min: 1 })) {
    return res.status(400).json({ error: 'User id must be a positive integer' });
  }

  if (!['in', 'out', 'adjustment'].includes(type)) {
    return res.status(400).json({ error: 'Type must be one of: in, out, adjustment' });
  }

  if (
    quantity_change === undefined ||
    quantity_change === null ||
    !Number.isFinite(Number(quantity_change))
  ) {
    return res.status(400).json({ error: 'Quantity change must be a number' });
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return res.status(400).json({ error: 'Notes must be a string' });
  }

  next();
};
