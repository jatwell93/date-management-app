# LLXPRT - Date Management Application

## Project Overview

This is a full-stack inventory management application built with React (frontend) and Node.js/Express (backend) with a SQLite database for data persistence. The application manages products, inventory items, and store areas with authentication and authorization capabilities. This project follows a spec-driven development approach using the Gemini Spec Kit framework.

## Technologies Used

### Backend
- Node.js with Express
- TypeScript
- SQLite3 for database
- ts-node for development
- JWT authentication

### Frontend
- React with TypeScript
- Create React App
- React Router for navigation
- Tailwind CSS for styling

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── index.ts         # Main server file
│   │   ├── database.ts      # Database setup and initialization
│   │   ├── routes/          # API route handlers
│   │   ├── models/          # Data models
│   │   ├── services/        # Business logic services
│   │   ├── middleware/      # Middleware functions
│   │   └── tests/           # Test files
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── index.tsx
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components
│   │   └── lib/             # Utility libraries
│   ├── package.json
│   └── tsconfig.json
└── specs/
    └── 001-build-a-progressive/
        ├── spec.md
        ├── plan.md
        ├── tasks.md
        ├── data-model.md
        └── contracts/
```

## Spec-Driven Development Framework

This project follows the Gemini Spec Kit methodology for spec-driven development:

### Specification Process
- **Feature Definition**: The application was initially defined as a "Progressive Web Application for retail store inventory date management and markdown tracking"
- **Requirements Gathering**: Comprehensive feature specification with user stories, acceptance criteria, and functional requirements
- **Implementation Planning**: Detailed plan with phases including research, design, and task generation
- **Task Breakdown**: Granular task breakdown across backend, frontend, and general development areas

### Key Spec Documents
- `specs/001-build-a-progressive/spec.md` - Complete feature specification with user scenarios, requirements, and acceptance criteria
- `specs/001-build-a-progressive/plan.md` - Implementation plan with technical context and phase breakdown
- `specs/001-build-a-progressive/tasks.md` - Detailed task breakdown for implementation
- `specs/001-build-a-progressive/data-model.md` - Database schema definition
- `.specify/features/build-a-pwa-for-retail-inventory.md` - High-level feature documentation

### Constitution Compliance
The project strictly follows the Pharma Date Manager Constitution, which enforces:
- Mobile-first progressive web application design
- Data integrity over all other considerations
- Web standards with TypeScript excellence
- Offline-first architecture
- Automated backup and recovery requirements
- Production-quality testing standards
- Task-based development with AI assistance
- Deployment and maintenance strategy adherence

## Key Components

### Backend Components
1. **Database Schema** - Uses SQLite with multiple tables:
   - Products table
   - Inventory items table
   - Store areas table
   - Users table
   - Audit log table

2. **API Routes** - Protected routes for:
   - Authentication (/auth)
   - Products (/products)
   - Inventory items (/inventory-items)
   - Store areas (/store-areas)
   - Reports (/reports)
   - Dashboard (/dashboard)
   - Users (/users)

3. **Authentication** - Token-based authentication with middleware

4. **Error Handling** - Global error handling middleware

### Frontend Components
1. **Routing** - Protected routes with authentication
2. **Navigation** - Header navigation bar
3. **Pages** - 
   - Login page
   - Scan page
   - Dashboard page
   - Reports page
   - Usage report page
   - Markdown calculator
   - User management page

## Building and Running

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

## Database Schema

### Products Table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `barcode`: TEXT UNIQUE NOT NULL
- `sku`: TEXT UNIQUE NOT NULL
- `name`: TEXT NOT NULL
- `cost_price`: REAL NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### Inventory Items Table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `product_id`: INTEGER NOT NULL
- `expiry_date`: TEXT NOT NULL
- `location_id`: INTEGER NOT NULL
- `status`: TEXT NOT NULL DEFAULT 'Normal'
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- FOREIGN KEY (product_id) REFERENCES products (id)
- FOREIGN KEY (location_id) REFERENCES store_areas (id)

### Store Areas Table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `name`: TEXT UNIQUE NOT NULL
- `last_checked`: TEXT
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### Users Table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `pin`: TEXT NOT NULL
- `role`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### Audit Log Table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id`: INTEGER NOT NULL
- `inventory_item_id`: INTEGER NOT NULL
- `change_description`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- FOREIGN KEY (user_id) REFERENCES users (id)
- FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)

## API Endpoints

- GET `/` - Server health check
- POST `/auth/login` - Authenticate user
- GET `/products` - Get all products
- GET `/products/:id` - Get a specific product
- POST `/products` - Create a new product
- PUT `/products/:id` - Update a product
- DELETE `/products/:id` - Delete a product
- GET `/inventory-items` - Get all inventory items
- GET `/inventory-items/:id` - Get a specific inventory item
- POST `/inventory-items` - Create a new inventory item
- PUT `/inventory-items/:id` - Update an inventory item
- DELETE `/inventory-items/:id` - Delete an inventory item
- GET `/store-areas` - Get all store areas
- GET `/store-areas/:id` - Get a specific store area
- POST `/store-areas` - Create a new store area
- PUT `/store-areas/:id` - Update a store area
- DELETE `/store-areas/:id` - Delete a store area
- GET `/reports/usage` - Get usage reports
- GET `/dashboard/stats` - Get dashboard statistics
- GET `/reports/expiry` - Get expiry reports
- GET `/dashboard/analytics` - Get analytics data
- GET `/users` - Get all users
- GET `/users/:id` - Get a specific user
- POST `/users` - Create a new user
- PUT `/users/:id` - Update a user
- DELETE `/users/:id` - Delete a user

## Development Conventions

### Spec-Driven Development
- Follows the structured specification process with feature, plan, and task documents
- Maintains tight alignment between specifications and implementation
- Uses the Gemini Spec Kit toolchain for documentation and planning

### Backend
- Uses TypeScript for type safety
- Follows MVC pattern with controllers, services, and models
- Uses JWT-based authentication with middleware
- Implements proper error handling
- Uses SQLite with database initialization script
- Includes unit tests with Jest

### Frontend
- Uses React with TypeScript
- Implements routing with React Router
- Utilizes Tailwind CSS for styling
- Component-based architecture
- Mock authentication for demonstration
- Responsive design principles
- PWA-compatible architecture

### Constitution Compliance
- Mobile-first progressive web application design
- Data integrity enforcement (non-negotiable)
- Production-quality testing coverage
- Offline-first architecture requirements
- Automated backup and recovery protocols
- Task-based development with AI assistance requirements

## Implementation Phases

1. **Research Phase** - Initial understanding and clarification of requirements
2. **Design Phase** - Database schema design and API contract definition
3. **Task Planning Phase** - Detailed task breakdown and assignment
4. **Implementation Phase** - Coding according to specifications and tasks
5. **Validation Phase** - Testing and quality assurance

## Project Governance

- All development adheres to the Pharma Date Manager Constitution
- Constitutional principles supersede all other practices
- PRs must verify mobile functionality, data integrity, and offline capabilities
- TypeScript strict mode is mandatory
- React best practices must be followed
- PWA requirements must be met
- Regular testing against constitution requirements