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

- Create, Read, Update, and Delete date entries
- SQLite database for data storage
- RESTful API endpoints for data operations
- TypeScript for type safety
- React frontend for user interface

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

- GET `/` - Server health check
- GET `/dates` - Get all dates
- GET `/dates/:id` - Get a specific date by ID
- POST `/dates` - Create a new date
- PUT `/dates/:id` - Update a date
- DELETE `/dates/:id` - Delete a date

## Database Schema

The application uses a single table called `dates` with the following columns:
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `date`: TEXT NOT NULL (ISO date format)
- `title`: TEXT NOT NULL
- `description`: TEXT (optional)

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

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

## License

This project is licensed under the MIT License.