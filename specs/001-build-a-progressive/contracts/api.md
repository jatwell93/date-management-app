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
  "token": "<jwt_token>"
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
```json
[
  { "month": "YYYY-MM", "totalMarkdownValue": 123.45, "itemCount": 10 },
  { "month": "YYYY-MM", "totalMarkdownValue": 67.89, "itemCount": 5 }
]
```
### `GET /reports/usage`

Retrieves a report on the number of items entered by each team member.

**Response (200 OK)**:
```json
[
  { "user": "Manager", "scans": 150, "markdowns": 20 },
  { "user": "Team Member", "scans": 100, "markdowns": 10 }
]
```

### `GET /dashboard`

Retrieves data for the manager's dashboard.

**Response (200 OK)**:
```json
{
  "totalProducts": 1500,
  "expiringSoon": 50,
  "markdownItems": 75,
  "recentActivity": [
    { "id": 1, "description": "Product A scanned", "timestamp": "YYYY-MM-DDTHH:MM:SSZ" }
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
