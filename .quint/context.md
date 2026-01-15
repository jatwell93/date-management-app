# Bounded Context

## Vocabulary

- **Application**: A full-stack application for date management, built with React (frontend) and Node.js/Express (backend) with a SQLite database.
- **Backend**: Node.js with Express, TypeScript, SQLite3. Provides RESTful API endpoints.
- **Frontend**: React with TypeScript, Create React App. Provides a responsive user interface. Utilizes Radix UI and Tailwind CSS.
- **User**: Can be "Manager" or "Team Member" with role-based access control. Authenticates with a PIN.
- **Product**: An item with a barcode, SKU, name, and cost price. Inventory
- **Item**: A specific instance of a product with an expiry date, location, and status. Store
- **Area**: A physical location for inventory items. Audit
- **Log**: Records changes to inventory items made by users.
- **Migration**: Database schema changes managed by `ts-node src/migrations/migrate.ts`. Offline
- **Capabilities**: Frontend supports offline data storage with IndexedDB and background synchronization. CSV
- **Upload**: Products can be uploaded via CSV. The CSV must contain SKU, Name, Cost, and Barcode. The column names are flexible and case-insensitive. Cost can be in various formats including different currency symbols and number formats.

## Invariants

The application must use a SQLite database for data persistence. Backend must be built with Node.js and Express. Frontend must be built with React. TypeScript must be used for both frontend and backend for type safety. User authentication must be PIN-based with role-based access control (Manager/Team Member). All inventory changes must be audit-logged. The system must maintain accurate expiry dates for inventory items. API endpoints must be RESTful. Frontend must support offline capabilities. Frontend must be built for production and served by the backend in deployment. All tests (`npm test` in backend, `craco test` in frontend) must pass. Node.js version must be >=14.x. npm version must be >=6.x. CSV uploads must contain the required columns: SKU, Name, Cost, and Barcode (or their accepted aliases). CSV column names are case-insensitive and ignore leading/trailing whitespace. Cost values in CSVs must be positive numbers and can be in various formats. SKU and Barcode fields in CSVs have a maximum length of 100 characters, and Name has a maximum of 200 characters.
