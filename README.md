# Date Management Application

This is a full-stack application built with React (frontend) and Node.js/Express (backend) with a SQLite database for data persistence.

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── index.ts         # Main server file
│   │   └── database.ts      # Database setup and initialization
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

## Features

- **User Management & Authentication**: Secure user login with PIN, role-based access control (Manager/Team Member).
- **Core Inventory Management**: CRUD operations for products, inventory items, and store areas. Automated markdown calculations and audit logging for all inventory changes.
- **Reporting & Analytics**: Monthly expiry reports, basic analytics dashboard, and usage reports.
- **Progressive Web Application (PWA) & Offline Capabilities**: Mobile-first scanning interface, offline data storage with IndexedDB, and background synchronization.
- SQLite database for data persistence.
- RESTful API endpoints for all data operations.
- TypeScript for type safety.
- React frontend for a responsive user interface.

## Technologies Used

### Backend
- Node.js with Express
- TypeScript
- SQLite3 for database
- ts-node for development

### Frontend
- React with TypeScript
- Create React App

## Setup Instructions

### Prerequisites
- Node.js (>=14.x)
- npm (>=6.x)

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

## API Endpoints

  If you're seeing unexpected classifications:
  - In the detailed expiry report (which recalculates statuses
   dynamically based on expiry dates), check that the expiry 
  dates are accurate.
  - In the overview reports page (which uses stored statuses),
   the counts might be outdated—use the new endpoint to 
  refresh them.


  To trigger the update, you can make a POST request to 
  http://localhost:3000/reports/update-statuses with your 
  auth token (adjust port if needed). Alternatively, 
  restarting the backend will cause the daily scheduler to 
  run and update statuses.

The backend provides the following API endpoints:

Public Routes
- POST /auth/login - User authentication

Protected Routes (require authentication token)

Products
- GET /products - Get all products
- GET /products/:id - Get a specific product by ID
- GET /products/by-barcode/:barcode - Get a specific product
   by barcode
- GET /products/by-sku/:sku - Get a specific product by SKU
- POST /products - Create a new product
- PUT /products/:id - Update a product
- DELETE /products/:id - Delete a product
- POST /products/upload-csv - Upload and process a
   CSV/XLSX/XLS file of products

Inventory Items
- GET /inventory-items - Get all inventory items
- GET /inventory-items/:id - Get a specific inventory item
   by ID
- GET /inventory-items/product/:productId - Get inventory
   items for a specific product
- GET /inventory-items/by-barcode/:barcode - Get inventory
   items for a specific product by barcode
- GET /inventory-items/recent/product/:productId - Get the
   most recent inventory items for a specific product
- GET /inventory-items/location/:locationId - Get inventory
   items for a specific location
- POST /inventory-items - Create a new inventory item
- PUT /inventory-items/:id - Update an inventory item
- DELETE /inventory-items/:id - Delete an inventory item

Store Areas
- GET /store-areas - Get all store areas
- GET /store-areas/:id - Get a specific store area by ID
- GET /store-areas/name/:name - Get store areas by name
- POST /store-areas - Create a new store area
- PUT /store-areas/:id - Update a store area
- DELETE /store-areas/:id - Delete a store area

Reports
- GET /reports/expiry - Get monthly expiry report
- GET /reports/expiry-details - Get detailed expiry report
   for next 90 days
- GET /reports/monthly-markdown - Get monthly markdown report
- GET /reports/usage - Get usage report
- GET /reports/daily-usage - Get daily usage report for past
   90 days
- GET /reports/analytics - Get dashboard analytics data


Dashboard
- GET /dashboard - Get dashboard data

Users (Manager role only)
- GET /users - Get all users
- GET /users/:id - Get a specific user by ID
- POST /users - Create a new user
- PUT /users/:id - Update a user
- DELETE /users/:id - Delete a user

Root
- GET / - Server health check

## Database Schema

The application uses the following tables:

### `products` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `barcode`: TEXT UNIQUE NOT NULL
- `sku`: TEXT UNIQUE NOT NULL
- `name`: TEXT NOT NULL
- `cost_price`: REAL NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `inventory_items` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `product_id`: INTEGER NOT NULL (FOREIGN KEY to `products`)
- `expiry_date`: TEXT NOT NULL
- `location_id`: INTEGER NOT NULL (FOREIGN KEY to `store_areas`)
- `status`: TEXT NOT NULL DEFAULT 'Normal'
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `store_areas` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `name`: TEXT UNIQUE NOT NULL
- `last_checked`: TEXT
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `users` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `pin`: TEXT NOT NULL
- `role`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `audit_log` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id`: INTEGER NOT NULL (FOREIGN KEY to `users`)
- `inventory_item_id`: INTEGER NOT NULL (FOREIGN KEY to `inventory_items`)
- `change_description`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

## Running Tests

```bash
cd backend
npm test
```

## Building for Production

### Backend
```bash
cd backend
npm run build
```

### Frontend
```bash
cd frontend
npm run build
```

5624 is the default pin

## Deployment

To deploy the application, you will need to build both the frontend and backend, and then serve the frontend's static files from the backend server.

1.  **Build Frontend**: Navigate to the `frontend` directory and run `npm run build`. This will create a `build` directory with the optimized static assets.

2.  **Build Backend**: Navigate to the `backend` directory and run `npm run build`. This will transpile the TypeScript code to JavaScript.

3.  **Configure Backend to Serve Frontend**: You will need to modify the `backend/src/index.ts` file to serve the static files from the frontend's `build` directory. Add the following lines to `backend/src/index.ts` before any other routes:

    ```typescript
    import path from 'path';

    // Serve static files from the React app
    app.use(express.static(path.join(__dirname, '../../frontend/build')));

    // All other GET requests not handled by the API will return the React app
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../../frontend/build/index.html'));
    });
    ```

4.  **Run Backend Server**: After making the changes, build the backend again (`npm run build` in the `backend` directory) and then start the server:
    ```bash
    cd backend
    npm start
    ```

    The application should now be accessible on `http://localhost:3001` (or the port configured in `backend/src/index.ts`).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

## License

This project is licensed under the MIT License.