# Data Model: Handling Expired Inventory Items

**Feature**: Handling Expired Inventory Items
**Date**: 11/10/2025

## Overview

This document describes the data model changes required to support handling expired inventory items. The system already tracks items with an "Expired" status, but needs additional functionality to process these items and track financial losses.

## Updated Database Schema

### 1. New Table: expired_item_transactions

This table will track all transactions related to expired items, including both "sold through" and "expired" actions with units discarded.

```
expired_item_transactions
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── inventory_item_id: INTEGER NOT NULL
├── user_id: INTEGER NOT NULL
├── action: TEXT NOT NULL (values: 'sold_through', 'expired')
├── units_discarded: INTEGER (only required when action is 'expired')
├── financial_loss: REAL (calculated as units_discarded * cost_price)
├── transaction_date: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
├── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
└── updated_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

Foreign Keys:
- inventory_item_id → inventory_items.id
- user_id → users.id
```

### 2. Existing Table: inventory_items (with potential considerations)

The current inventory_items table already has what we need:

```
inventory_items
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── product_id: INTEGER NOT NULL
├── expiry_date: TEXT NOT NULL
├── location_id: INTEGER NOT NULL
├── status: TEXT NOT NULL DEFAULT 'Normal'
├── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
└── updated_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

Foreign Keys:
- product_id → products.id
- location_id → store_areas.id

Status values: 'Normal', 'Markdown 1', 'Markdown 2', 'Markdown 3', 'Expired', 'Damaged'
```

We'll be working with items that have status = 'Expired'.

### 3. Existing Table: products

```
products
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── barcode: TEXT UNIQUE NOT NULL
├── sku: TEXT UNIQUE NOT NULL
├── name: TEXT NOT NULL
├── cost_price: REAL NOT NULL
├── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
└── updated_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### 4. Existing Table: store_areas

```
store_areas
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── name: TEXT UNIQUE NOT NULL
├── last_checked: TEXT
├── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
└── updated_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### 5. Existing Table: users

```
users
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── pin: TEXT NOT NULL
├── role: TEXT NOT NULL
├── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
└── updated_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### 6. Existing Table: audit_log

```
audit_log
├── id: INTEGER PRIMARY KEY AUTOINCREMENT
├── user_id: INTEGER NOT NULL
├── inventory_item_id: INTEGER NOT NULL
├── change_description: TEXT NOT NULL
└── created_at: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

Foreign Keys:
- user_id → users.id
- inventory_item_id → inventory_items.id
```

## Relationships

```
users (1) → (m) expired_item_transactions (track who processed)
inventory_items (1) → (m) expired_item_transactions (what was processed)
inventory_items (1) → (m) audit_log (track all changes)
products (1) → (m) inventory_items (what product is it)
store_areas (1) → (m) inventory_items (where is it located)
```

## Key Queries

### 1. Get all expired items for the expired items page
```sql
SELECT 
    ii.id,
    ii.expiry_date,
    p.sku,
    p.name AS product_name,
    p.cost_price,
    sa.name AS location_name,
    ii.status,
    COUNT(ii.id) AS quantity_available
FROM inventory_items ii
JOIN products p ON ii.product_id = p.id
JOIN store_areas sa ON ii.location_id = sa.id
WHERE ii.status = 'Expired'
GROUP BY ii.product_id, ii.location_id, p.cost_price
ORDER BY ii.expiry_date ASC;
```

### 2. Get financial losses by SKU
```sql
SELECT 
    p.sku,
    p.name AS product_name,
    SUM(eit.financial_loss) AS total_loss
FROM expired_item_transactions eit
JOIN inventory_items ii ON eit.inventory_item_id = ii.id
JOIN products p ON ii.product_id = p.id
WHERE eit.action = 'expired'
GROUP BY p.id
ORDER BY total_loss DESC;
```

### 3. Get financial losses by store area
```sql
SELECT 
    sa.name AS location_name,
    SUM(eit.financial_loss) AS total_loss
FROM expired_item_transactions eit
JOIN inventory_items ii ON eit.inventory_item_id = ii.id
JOIN store_areas sa ON ii.location_id = sa.id
WHERE eit.action = 'expired'
GROUP BY sa.id
ORDER BY total_loss DESC;
```

### 4. Get all expired item transactions for audit trail
```sql
SELECT 
    eit.id,
    eit.action,
    eit.units_discarded,
    eit.financial_loss,
    eit.transaction_date,
    u.role AS user_role,
    p.sku,
    p.name AS product_name,
    sa.name AS location_name
FROM expired_item_transactions eit
JOIN users u ON eit.user_id = u.id
JOIN inventory_items ii ON eit.inventory_item_id = ii.id
JOIN products p ON ii.product_id = p.id
JOIN store_areas sa ON ii.location_id = sa.id
ORDER BY eit.transaction_date DESC;
```

## Business Rules

1. An inventory item with status "Expired" can only be processed once through this system
2. When marking as "expired", units discarded cannot exceed the available quantity
3. Financial loss is calculated as: units_discarded * cost_price
4. All expired item transactions must be logged in the audit trail
5. Processing an expired item as "sold through" or "expired" should update or remove the inventory record appropriately

## Data Integrity

- The expired_item_transactions table will have foreign key constraints to ensure data integrity
- The application layer will validate that units discarded do not exceed available quantities
- Transactions will be processed in a way that maintains consistency between the various tables

## Performance Considerations

- Indexes should exist on frequently queried columns:
  - inventory_items.status (for finding expired items)
  - inventory_items.product_id (for joining with products)
  - inventory_items.location_id (for joining with store_areas)
  - expired_item_transactions.transaction_date (for chronological queries)
  - expired_item_transactions.action (to filter by action type)