# Database Patterns

This document describes the database abstraction layer using Prisma ORM for cross-environment compatibility.

## Overview

The database abstraction provides a unified interface for database operations, allowing the application to seamlessly switch between:

- **Development/Test**: SQLite (local file database)
- **Production**: Neon PostgreSQL (managed PostgreSQL, optionally reached from Workers through Hyperdrive)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Application Code                          │
│                  (Services, Controllers)                     │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                   Database Factory                           │
│     createDatabaseClient() | getDefaultDatabaseClient()      │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    Prisma Client                             │
│           Unified API for database operations                │
└─────────────────────────┬────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐
│       SQLite         │       │   Neon PostgreSQL    │
│    (Development)     │       │    (Production)      │
│                      │       │                      │
│  - Local file        │       │  - Serverless        │
│  - No setup needed   │       │  - SSL required      │
└──────────────────────┘       └──────────────────────┘
```

## Schema Files

The active generated client is based on the SQLite development schema in `prisma/schema.prisma`. Production PostgreSQL compatibility is represented by the production schema and Neon migration workflow.

| File                        | Provider | Use Case                    |
| --------------------------- | -------- | --------------------------- |
| `schema.prisma`             | SQLite   | Development, testing        |
| `production/schema.prisma`  | PostgreSQL | Production with Neon       |

### Switching Schemas

**For Development (default):**

```bash
npx prisma generate
```

**For Production:**

```bash
npx prisma generate --schema=./prisma/production/schema.prisma
```

## Usage

### Basic Usage

```typescript
import { getDefaultDatabaseClient } from './database';

const db = getDefaultDatabaseClient();

// Create a product
const product = await db.product.create({
  data: {
    barcode: '1234567890123',
    sku: 'PROD-001',
    name: 'Sample Product',
    costPrice: 9.99,
  },
});

// Find products
const products = await db.product.findMany({
  where: {
    status: 'Normal',
  },
});
```

### With Dependency Injection

```typescript
import { PrismaClient } from '@prisma/client';
import { createDatabaseClient } from './database';

class InventoryService {
  constructor(private db: PrismaClient) {}

  async getExpiringItems(days: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);

    return this.db.inventoryItem.findMany({
      where: {
        expiryDate: { lte: cutoffDate },
        status: 'Normal',
      },
      include: {
        product: true,
        storeArea: true,
      },
    });
  }
}

// In production
const service = new InventoryService(createDatabaseClient());

// In tests
const mockDb = { inventoryItem: { findMany: jest.fn() } };
const service = new InventoryService(mockDb as any);
```

### Transactions

```typescript
import { withTransaction } from './database';

async function transferInventory(db: PrismaClient, itemId: number, newLocationId: number) {
  await withTransaction(db, async (tx) => {
    // Update inventory item location
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: { locationId: newLocationId },
    });

    // Create audit log
    await tx.auditLog.create({
      data: {
        userId: currentUser.id,
        inventoryItemId: itemId,
        changeDescription: `Moved to location ${newLocationId}`,
      },
    });
  });
}
```

## Models

### Product

```typescript
interface Product {
  id: number;
  barcode: string; // Unique product barcode
  sku: string; // Unique SKU
  name: string;
  costPrice: number;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### InventoryItem

```typescript
interface InventoryItem {
  id: number;
  productId: number;
  expiryDate: Date;
  locationId: number;
  status: 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired';
  createdAt: Date;
  updatedAt: Date;
}
```

### StoreArea

```typescript
interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string; // Optional sub-department
  lastChecked?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## Environment Configuration

### Development (Default)

```bash
# .env
NODE_ENV=development
DATABASE_URL=file:./database.sqlite
```

### Production

```bash
# .env
NODE_ENV=production
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
NEON_CONNECTION_STRING=postgresql://user:password@host/database?sslmode=require
```

## Migrations

### Development (SQLite)

```bash
# Generate migration from schema changes
npx prisma migrate dev --name add_new_field

# Apply migrations
npx prisma migrate dev

# Reset database
npx prisma migrate reset
```

### Production (Neon PostgreSQL)

Use Neon branches or a disposable production-like database for migration verification:

```bash
# Verify the target connection string is available
npm run verify:neon

# Apply the production schema/migration workflow for the selected Neon branch
npm run migrate:prod

# Validate production-like test compatibility when credentials are available
npm run test:prod
```

See `docs/database-migration-guide.md` and the root `docs/neon-workflow.md` for detailed workflow.

## Indexes

The schema includes indexes optimized for common queries:

| Table                     | Indexed Fields          | Purpose          |
| ------------------------- | ----------------------- | ---------------- |
| products                  | sku, barcode            | Product lookups  |
| inventory_items           | expiryDate, status      | Expiry queries   |
| inventory_items           | productId, locationId   | Join performance |
| expired_item_transactions | transactionDate, action | Reports          |

## Testing

### Mocking the Database Client

```typescript
const mockDb = {
  product: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 1 }),
  },
  inventoryItem: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  $transaction: jest.fn((fn) => fn(mockDb)),
};

const service = new MyService(mockDb as unknown as PrismaClient);
```

### Integration Testing with SQLite

```typescript
import { createDatabaseClient, resetDefaultDatabaseClient } from './database';

describe('Integration Tests', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = createDatabaseClient({
      connectionUrl: 'file:./test.db',
    });
    // Run migrations
    await db.$executeRaw`...`;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('should create and find products', async () => {
    const product = await db.product.create({ data: {...} });
    const found = await db.product.findUnique({ where: { id: product.id } });
    expect(found).toEqual(product);
  });
});
```

## Performance Considerations

1. **Connection Management**: Neon is the production database; Workers deployments use the configured connection secret and Hyperdrive binding where enabled
2. **Query Optimization**: Use `select` to limit returned fields
3. **Batch Operations**: Use `createMany` for bulk inserts
4. **Indexes**: Ensure queries use indexed columns in WHERE clauses

### Example: Optimized Query

```typescript
// Instead of loading all fields
const items = await db.inventoryItem.findMany({
  where: { status: 'Normal' },
});

// Select only needed fields
const items = await db.inventoryItem.findMany({
  where: { status: 'Normal' },
  select: {
    id: true,
    expiryDate: true,
    product: {
      select: {
        name: true,
        sku: true,
      },
    },
  },
});
```

## Error Handling

```typescript
import { Prisma } from '@prisma/client';

try {
  await db.product.create({ data: {...} });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      // Unique constraint violation
      throw new Error('Product with this SKU already exists');
    }
  }
  throw error;
}
```

## Troubleshooting

| Issue              | Cause               | Solution                                  |
| ------------------ | ------------------- | ----------------------------------------- |
| Connection timeout | Wrong DATABASE_URL  | Check .env file                           |
| Schema mismatch    | Wrong schema file   | Run `npx prisma generate`                 |
| Migration errors   | Conflicting changes | Run `npx prisma migrate reset` (dev only) |
| Type errors        | Outdated client     | Run `npx prisma generate`                 |
