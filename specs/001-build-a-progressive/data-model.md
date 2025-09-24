# Data Model

This data model is based on the entities defined in the feature specification.

## Tables

### `products`

Represents a unique product in the inventory.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier for the product. |
| `barcode` | TEXT | UNIQUE NOT NULL | The product's barcode. |
| `sku` | TEXT | UNIQUE NOT NULL | The product's Stock Keeping Unit. |
| `name` | TEXT | NOT NULL | The name of the product. |
| `cost_price` | REAL | NOT NULL | The cost price of the product. |
| `created_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of creation. |
| `updated_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of last update. |

### `inventory_items`

Represents a specific instance of a product in the inventory.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier for the inventory item. |
| `product_id` | INTEGER | NOT NULL, FOREIGN KEY (`products.id`) | The product this item is an instance of. |
| `expiry_date` | TEXT | NOT NULL | The expiry date of the item (ISO 8601 format). |
| `location_id` | INTEGER | NOT NULL, FOREIGN KEY (`store_areas.id`) | The location of the item in the store. |
| `status` | TEXT | NOT NULL DEFAULT 'Normal' | The current status of the item ('Normal', 'Markdown 1', 'Markdown 2', 'Markdown 3', 'Expired'). |
| `created_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of creation. |
| `updated_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of last update. |

### `store_areas`

Represents a physical location in the store.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier for the store area. |
| `name` | TEXT | UNIQUE NOT NULL | The name of the store area (e.g., "Aisle 5, Bay 2"). |
| `last_checked` | TEXT | | Timestamp of when the area was last checked. |
| `created_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of creation. |
| `updated_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of last update. |

### `users`

Represents a user of the system.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier for the user. |
| `pin` | TEXT | NOT NULL | The user's 4-6 digit PIN for authentication. |
| `role` | TEXT | NOT NULL | The user's role ('Manager' or 'Team Member'). |
| `created_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of creation. |
| `updated_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of last update. |

### `audit_log`

Logs all changes to the inventory.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier for the log entry. |
| `user_id` | INTEGER | NOT NULL, FOREIGN KEY (`users.id`) | The user who made the change. |
| `inventory_item_id` | INTEGER | NOT NULL, FOREIGN KEY (`inventory_items.id`) | The inventory item that was changed. |
| `change_description` | TEXT | NOT NULL | A description of the change that was made. |
| `created_at` | TEXT | NOT NULL DEFAULT CURRENT_TIMESTAMP | Timestamp of the change. |
