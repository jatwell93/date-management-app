# Feature Specification: Progressive Web Application for Retail Inventory Date Management

**Feature Branch**: `001-build-a-progressive`
**Created**: 21/09/2025
**Status**: Finalized
**Input**: User description: "Build a Progressive Web Application for retail store inventory date management and markdown tracking. The system replaces manual spreadsheet processes with mobile barcode scanning for expiry date entry, automated markdown calculations (cost price +20% at 3 months, cost at 2 months, cost -20% at 1 month from expiry), and real-time inventory tracking of mark downs across customizable store areas. Core features include: mobile-first barcode scanning interface for date checking, editable store area management with last-checked tracking, automated cost-based markdown calculations, monthly expiry reporting with printable markdown lists, basic analytics dashboard showing expiry trends and usage metrics, offline-capable PWA functionality for uninterrupted store operations, and CSV-to-SQLite database migration path. The application prioritizes utility over aesthetics, supports manager oversight through usage reporting, and includes audit trails for inventory changes to maximise profitable stock and deletion of items with high-mark down rates. Team members scan barcodes on mobile devices, enter expiry dates, track which store areas were checked when, and generate monthly reports for physical markdown implementation."

## Clarifications

### Session 2025-09-23
- Q: What is the expected scale of the inventory in terms of the number of unique products? This will help determine the right database design. → A: 10,000 to 50,000
- Q: How should offline data be secured on the user's device? → A: No specific encryption required; rely on device's default security.
- Q: What are the distinct states an inventory item can be in as it approaches its expiry date? This clarifies the data model and business logic. → A: Four states: 'Normal', 'Markdown 1' (3 months from expiry), 'Markdown 2' (2 months from expiry), 'Markdown 3' (1 month from expiry), and 'Expired'.

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a retail team member, I want to scan product barcodes with my mobile device, enter expiry dates, and have the system automatically track inventory and calculate markdowns, so that we can replace our manual spreadsheet process and efficiently manage stock.

### Acceptance Scenarios
1.  **Given** a team member is logged in on a mobile device, **When** they scan a product barcode, **Then** the system should prompt for an expiry date.
2.  **Given** an expiry date is entered for a product, **When** the date is within the defined markdown period, **Then** the system should calculate the correct markdown price and update the inventory.
3.  **Given** a store manager is logged in, **When** they access the reporting dashboard, **Then** they should see a monthly report of all items expiring and their calculated markdown prices.
4.  **Given** it's the start of a month, **When** a manager generates the monthly markdown report, **Then** the system should show all items expiring 3 months out with their calculated markdown prices for physical implementation.
5.  **Given** a team member is checking a store area, **When** they complete checking all items in that area, **Then** the system should update the "last checked" timestamp for that area.
6.  **Given** the system is offline, **When** a team member scans barcodes and enters expiry dates, **Then** the data should be stored locally and sync when connectivity is restored
7.  **Given** a store manager is logged in, **When** they navigate to the user management section, **Then** they should be able to create, edit, and delete user accounts, including assigning roles and setting PINs.

### Edge Cases
-   What happens when a barcode is scanned that is not in the product database? Team member can manually add the item details, barcode, SKU, product name and cost and then add the expiry.
-   How does the system handle offline data entry and synchronization when the network is restored? For offline sync conflicts, the last record synced to the server will be the authoritative one.
-   What happens if a user enters an invalid date format for the expiry date? Entry is editable, team member can adjust the date. System should flag items with clear entry errors e.g. 2040/09/21. Basic date picker rules should apply stopping users entering months and days that don't exist e.g. 2025/02/30.

## Requirements *(mandatory)*

### Functional Requirements
-   **FR-001**: The system MUST provide a mobile-first scanning interface. The main screen will feature a large, central camera view with a 'Scan Barcode' button. Above will be a smaller text box (default is number pad) when tapped the user can manually type a SKU (stands for 'stock keeping unit) or barcode. On a successful scan, the product's name, SKU and cost price will be displayed. An "Expiry Date" input field (dd/mm/yyyy) will appear with a numeric keypad. After date entry, a "Confirm & Save" button saves the data and resets the screen for the next scan.
-   **FR-002**: The system MUST allow Managers to manage the store layout by adding, editing, and deleting departments and bays. This is to inform stock decisions and plan markdown sections.
-   **FR-003**: The system MUST automatically calculate markdown prices based on the following rules: cost price +20% at 3 months, cost at 2 months, cost -20% at 1 month from expiry.
-   **FR-004**: The system MUST generate monthly reports of expiring items as a formatted, printable PDF. The report columns, from left to right, will be: SKU, Product Name, Location, Expiry, Markdown Price, Barcode.
-   **FR-005**: The system MUST provide a basic analytics dashboard for Managers, displaying: 1. A bar graph of the total value of stock scheduled for markdown next month. 2. A table of the top 5 most frequently marked-down items. 3. A table of store areas not checked in the last 30 days.
-   **FR-006**: The application MUST be a Progressive Web Application (PWA) with offline capabilities.
-   **FR-007**: The system MUST allow Managers to update product information monthly via a CSV upload, which will be migrated to the SQLite database.
-   **FR-008**: The system MUST include audit trails for all inventory changes to identify items with low sales and high markdown rates, informing decisions to discontinue products.
-   **FR-009**: The system MUST support manager oversight by providing usage reports showing how many items each team member has entered.
-   **FR-010**: The system MUST track and display "last checked" timestamps for each store area.
-   **FR-011**: The system MUST automatically handle product price updates. When a new price CSV is uploaded to the SQL database, the prices in the application must update to match the new file.
-   **FR-012**: The system MUST provide a simple calculator for manual markdown verification.
-   **FR-013**: The application will have two roles: Manager and Team Member, authenticated by a 4-6 digit PIN. Managers have access to settings (store areas, team members) and the analytics dashboard. Team Members can only add items and view the monthly report.
-   **FR-014**: The system MUST allow Managers to create new user accounts, specifying their role (Manager or Team Member) and an initial 4-6 digit PIN.
-   **FR-015**: The system MUST allow Managers to edit existing user accounts, including changing their role and resetting their PIN.
-   **FR-016**: The system MUST allow Managers to delete user accounts.

### Non-Functional Quality Attributes
- **Data Volume**: The system should be designed to handle an inventory of 10,000 to 50,000 unique products.
- **Security**: Offline data does not require specific encryption; the system will rely on the underlying device's default security features.

### Key Entities *(include if feature involves data)*
-   **Product**: Represents an item in the inventory, with attributes like barcode, cost price, and name.
-   **Inventory Item**: Represents a specific instance of a product, with an expiry date and location (store area). Its lifecycle includes the following states: 'Normal', 'Markdown 1' (3 months from expiry), 'Markdown 2' (2 months from expiry), 'Markdown 3' (1 month from expiry), and 'Expired'.
-   **Store Area**: Represents a physical location in the store where inventory is tracked.
-   **Markdown**: Represents a price reduction for an inventory item.
-   **User**: Represents a team member or manager using the system.

---

## Review & Acceptance Checklist

### Content Quality
-   [x] No implementation details (languages, frameworks, APIs)
-   [x] Focused on user value and business needs
-   [x] Written for non-technical stakeholders
-   [x] All mandatory sections completed

### Requirement Completeness
-   [x] No [NEEDS CLARIFICATION] markers remain
-   [x] Requirements are testable and unambiguous
-   [x] Success criteria are measurable
-   [x] Scope is clearly bounded
-   [x] Dependencies and assumptions identified

---

## Execution Status

-   [x] User description parsed
-   [x] Key concepts extracted
-   [x] Ambiguities marked and resolved
-   [x] User scenarios defined
-   [x] Requirements generated
-   [x] Entities identified
-   [x] Review checklist passed

---