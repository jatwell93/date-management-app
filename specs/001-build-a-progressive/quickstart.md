# Quickstart Guide

This guide provides a quick way to set up, run, and test the core functionality of the application, based on the user stories in the feature specification.

## 1. Setup and Run the Application

### Prerequisites

- Node.js (v18 or higher)
- npm (v9 or higher)
- Git

### Backend Setup

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Run database migrations and seed initial data:**
    ```bash
    npm run db:init
    npm run db:seed
    ```
    This will create the `database.sqlite` file and populate it with initial users (including a Manager) and some sample products/store areas.
4.  **Start the backend server:**
    ```bash
    npm start
    ```
    The backend server will start on `http://localhost:3001`.

### Frontend Setup

1.  **Open a new terminal and navigate to the frontend directory:**
    ```bash
    cd frontend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Start the frontend development server:**
    ```bash
    npm start
    ```
    The frontend application will open in your browser, usually at `http://localhost:3000`.

## 2. Initial User Setup and Login

Upon starting the application, you will be redirected to the login page.

-   **Manager Account:**
    -   **PIN:** `12345`
    -   **Role:** Manager
-   **Team Member Account:**
    -   **PIN:** `54321`
    -   **Role:** Team Member

Use the Manager PIN (`12345`) to log in and access all features, including user and store area management.

## 3. Testing Core Functionality

### Scenario 1: Scan a product and add an expiry date

1.  **Log in** as a "Team Member" (PIN: `54321`) or "Manager" (PIN: `12345`).
2.  **Navigate** to the "Scan" page.
3.  **Enter a barcode** (e.g., `123456789` for an existing product, or a new one like `999999999` to test manual addition).
4.  **Click** the "Scan" button.
    -   If an existing product, verify its details are displayed.
    -   If a new barcode, fill in the "New Product Details" form (Name, SKU, Cost Price) and click "Add New Product". Then, verify the product details are displayed.
5.  **Enter an expiry date** (e.g., a future date like `2026-12-31`).
6.  **Select a location** from the dropdown.
7.  **Click** the "Confirm & Save" button.
8.  **Verify** that a success message is displayed, and the screen resets, ready for the next scan.
9.  **(Optional) Test Offline:** Disconnect your internet, add an item, and then reconnect. The item should synchronize automatically.

### Scenario 2: Manage Store Areas (as a Manager)

1.  **Log in** as a "Manager" (PIN: `12345`).
2.  **Navigate** to the "Store Areas" page.
3.  **Add New Area:** Enter a name (e.g., "Freezer A") in the "New Area Name" input and click "Add Area". Verify the new area appears in the list.
4.  **Edit Area:** Click "Edit" next to an existing area, change its name, and click "Save changes". Verify the name is updated.
5.  **Delete Area:** Click "Delete" next to an area and confirm the deletion. Verify the area is removed from the list.

### Scenario 3: View Monthly Expiry Report (as a Manager)

1.  **Log in** as a "Manager" (PIN: `12345`).
2.  **Navigate** to the "Reports" page.
3.  **Verify** that the "Monthly Expiry Report" is displayed, showing months, expiring items count, and expired items count.

### Scenario 4: View Analytics Dashboard (as a Manager)

1.  **Log in** as a "Manager" (PIN: `12345`).
2.  **Navigate** to the "Dashboard" page.
3.  **Verify** that the dashboard displays "Total Products", "Expiring Soon", "Markdown Items", and "Recent Activity".

### Scenario 5: View User Usage Report (as a Manager)

1.  **Log in** as a "Manager" (PIN: `12345`).
2.  **Navigate** to the "Usage Report" page.
3.  **Verify** that the "User Usage Report" is displayed, showing users, their scan counts, and markdown counts.

### Scenario 6: Use Markdown Calculator

1.  **Log in** as a "Team Member" (PIN: `54321`) or "Manager" (PIN: `12345`).
2.  **Navigate** to the "Markdown Calculator" page.
3.  **Enter a Cost Price** (e.g., `20.00`).
4.  **Enter an Expiry Date** (e.g., `2025-10-01`).
5.  **Click** "Calculate Markdown".
6.  **Verify** that the correct "Status" and "Markdown Value" are displayed based on the expiry date.

### Scenario 7: Manage Users (as a Manager)

1.  **Log in** as a "Manager" (PIN: `12345`).
2.  **Navigate** to the "User Management" page.
3.  **Add New User:** Enter a PIN and select a role, then click "Create User". Verify the new user appears.
4.  **Edit User:** Select a user, change their role or reset PIN, and click "Update User". Verify changes.
5.  **Delete User:** Select a user and click "Delete User". Confirm deletion. Verify the user is removed.