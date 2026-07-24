import { Request, Response, NextFunction } from 'express';
import { getDb } from '../database';
import { releaseDb } from '../database';

/**
 * Data integrity middleware to perform additional database-level validation
 * This ensures data consistency and referential integrity beyond basic input validation
 */

// Middleware to validate that referenced entities exist before creating records
export const validateReferentialIntegrity = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const db = getDb();

  try {
    // For inventory items, validate that productId and locationId exist
    if (req.path.includes('/inventory-items') && req.method === 'POST') {
      const { productId, locationId } = req.body;

      if (productId) {
        const productExists = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
        if (!productExists) {
          return res.status(400).json({ error: 'Referenced product does not exist' });
        }
      }

      if (locationId) {
        const locationExists = db
          .prepare('SELECT id FROM store_areas WHERE id = ?')
          .get(locationId);
        if (!locationExists) {
          return res.status(400).json({ error: 'Referenced store location does not exist' });
        }
      }
    }

    // For audit logs, validate that user_id and inventory_item_id exist
    if (req.path.includes('/audit-log') && req.method === 'POST') {
      const { user_id, inventory_item_id } = req.body;

      if (user_id) {
        const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
        if (!userExists) {
          return res.status(400).json({ error: 'Referenced user does not exist' });
        }
      }

      if (inventory_item_id) {
        const itemExists = db
          .prepare('SELECT id FROM inventory_items WHERE id = ?')
          .get(inventory_item_id);
        if (!itemExists) {
          return res.status(400).json({ error: 'Referenced inventory item does not exist' });
        }
      }
    }

    next();
  } catch (_error) {
    res.status(500).json({ error: 'Database validation failed' });
  } finally {
    releaseDb(db);
  }
};

// Middleware to check for data consistency issues
export const validateDataConsistency = (req: Request, res: Response, next: NextFunction) => {
  // Check for conflicting data
  if (req.path.includes('/inventory-items') && req.method === 'POST') {
    const { productId, expiryDate, locationId } = req.body;

    // Check if the same product at the same location with the same expiry date already exists
    if (productId && expiryDate && locationId) {
      const db = getDb();
      try {
        const existingItem = db
          .prepare(
            `
          SELECT id FROM inventory_items 
          WHERE product_id = ? AND expiry_date = ? AND location_id = ?
        `,
          )
          .get(productId, expiryDate, locationId);

        if (existingItem) {
          return res.status(409).json({
            error:
              'An inventory item with the same product, expiry date, and location already exists',
          });
        }
      } catch (_error) {
        // Must return: `next()` below is outside this try, so without it the
        // request would continue into the route handler after the 500 was sent
        // (ERR_HTTP_HEADERS_SENT on the handler's own response).
        return res.status(500).json({ error: 'Data consistency check failed' });
      } finally {
        releaseDb(db);
      }
    }
  }

  next();
};

// Middleware to validate business rules
export const validateBusinessRules = (req: Request, res: Response, next: NextFunction) => {
  // Expiry date should not be more than 5 years in the future
  if (req.path.includes('/inventory-items') && (req.method === 'POST' || req.method === 'PUT')) {
    const { expiryDate } = req.body;

    if (expiryDate) {
      // Create date objects for expiry date and max future date at the start of the day in local timezone
      const expiry = new Date(expiryDate);
      expiry.setHours(0, 0, 0, 0); // Start of expiry day in local time

      const maxFutureDate = new Date();
      maxFutureDate.setHours(0, 0, 0, 0); // Start of max future date in local time
      maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 5);

      if (expiry > maxFutureDate) {
        return res.status(400).json({
          error: 'Expiry date cannot be more than 5 years in the future',
        });
      }
    }
  }

  // Product cost should not be negative
  if (req.path.includes('/products') && (req.method === 'POST' || req.method === 'PUT')) {
    const { cost_price } = req.body;

    if (cost_price !== undefined && parseFloat(cost_price) < 0) {
      return res.status(400).json({
        error: 'Product cost price cannot be negative',
      });
    }
  }

  next();
};
