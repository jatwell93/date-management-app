# API Contracts

This document defines the API endpoints for the backend service.

## Authentication

- All endpoints, except `/auth/login`, require a valid JWT token in the `Authorization` header.

## Endpoints

### `POST /auth/login`

Authenticates a user with their PIN.

**Request Body**:
```json
{
  "pin": "1234"
}
```

**Response (200 OK)**:
```json
{
  "token": "<jwt_token>",
  "user": {
    "id": 1,
    "role": "Manager"
  }
}
```

### `GET /products?barcode=<barcode>`

Retrieves a product by its barcode.

**Response (200 OK)**:
```json
{
  "id": 1,
  "barcode": "123456789",
  "sku": "SKU123",
  "name": "Product Name",
  "cost_price": 10.00
}
```

### `POST /inventory-items`

Adds a new inventory item.

**Request Body**:
```json
{
  "product_id": 1,
  "expiry_date": "2026-12-31",
  "location_id": 1
}
```

**Response (201 Created)**:
```json
{
  "id": 1,
  "product_id": 1,
  "expiry_date": "2026-12-31",
  "location_id": 1,
  "status": "Normal"
}
```

### `POST /products`

Creates a new product in the database. Used when a scanned barcode is not found.

**Request Body**:
```json
{
  "barcode": "987654321",
  "sku": "SKU987",
  "name": "New Product Name",
  "cost_price": 15.00
}
```

**Response (201 Created)**:
```json
{
  "id": 2,
  "barcode": "987654321",
  "sku": "SKU987",
  "name": "New Product Name",
  "cost_price": 15.00
}
```

### `GET /reports/monthly-markdown`

Generates the monthly markdown report.

**Response (200 OK)**:
- A PDF file containing the report.

### `GET /reports/usage`

Retrieves a report on the number of items entered by each team member.

**Response (200 OK)**:
```json
{
  "usage_data": [
    { "user_id": 2, "username": "Team Member A", "item_count": 150 },
    { "user_id": 3, "username": "Team Member B", "item_count": 98 }
  ]
}
```

### `GET /dashboard`

Retrieves data for the manager's dashboard.

**Response (200 OK)**:
```json
{
  "markdown_next_month_value": 1234.56,
  "top_5_markdown_items": [
    { "name": "Product A", "count": 50 },
    { "name": "Product B", "count": 45 }
  ],
  "areas_not_checked_30_days": [
    { "name": "Aisle 3, Bay 1" },
    { "name": "Aisle 7, Bay 4" }
  ]
}
```

### `POST /products/upload-csv`

Uploads a CSV file to update product information.

**Request**:
- `multipart/form-data` request with a `file` field containing the CSV.

**Response (200 OK)**:
```json
{
  "message": "Product data updated successfully."
}
```
