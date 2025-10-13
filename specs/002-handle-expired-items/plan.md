# Implementation Plan: Handling Expired Inventory Items

**Branch**: `002-handle-expired-items` | **Date**: 2025-10-11
**Spec**: [./spec.md](./spec.md)

## Summary
This plan outlines the implementation of a new feature to handle inventory items that have passed their expiry date. The system will provide a new page where users can view all expired items and mark them as either "sold through" or "expired". For items marked as expired, users will be required to specify the number of units to discard, which will be used to calculate financial losses per SKU and store location.

## Technical Context
**Language/Version**: TypeScript 5.x
**Primary Dependencies**: React, Node.js, Express.js, SQLite3, shadcn-ui
**Storage**: SQLite
**Testing**: Jest, React Testing Library
**Target Platform**: Web (Progressive Web App)
**Performance Goals**: Efficient loading of expired items (under 3 seconds)
**Constraints**: Offline capability needs to be maintained
**Scale/Scope**: 10,000 to 50,000 unique products

## Feature Requirements

### Functional Requirements
- **ER-001**: The system MUST provide a new page accessible from the main navigation to display all expired inventory items.
- **ER-002**: The system MUST display expired items in a table format showing: SKU, Product Name, Location, Expiry Date, Cost Price, Status, and Quantity Available.
- **ER-003**: The system MUST allow users to select an expired item and mark it as either "sold through" or "expired".
- **ER-004**: When marking an item as "expired", the system MUST require the user to enter the number of units being discarded.
- **ER-005**: The system MUST validate that the number of units being discarded is not greater than the available quantity.
- **ER-006**: The system MUST calculate financial losses when items are marked as expired: discarded units × cost price.
- **ER-007**: The system MUST maintain an audit trail of all expired item transactions including: user ID, item ID, action taken, units discarded, financial loss, and timestamp.
- **ER-008**: The system MUST provide reporting features showing financial losses per SKU and per store area.
- **ER-009**: The system MUST update inventory quantities when items are marked as sold through or discarded.
- **ER-100**: The system MUST maintain offline capability for this feature.

### Non-Functional Requirements
- **Data Volume**: The system should efficiently handle potentially thousands of expired items per month.
- **Security**: All expired item transactions must be logged for audit purposes.
- **Performance**: The expired items page should load efficiently even with a large number of expired items.

## Implementation Approach

### Phase 1: Backend Development
1. **Database Schema Update** (If needed)
   - Consider adding fields to track financial losses in inventory_items table
   - Determine if new tables are needed to store expired item transactions

2. **API Endpoints**
   - Create new endpoint to get all expired items
   - Create endpoint to handle marking items as "sold through" or "expired"
   - Update existing endpoints as required

3. **Business Logic**
   - Implement logic for handling expired item transactions
   - Implement financial loss calculations
   - Ensure data integrity when updating inventory

4. **Audit Trail**
   - Log all expired item transactions with relevant details

### Phase 2: Frontend Development
1. **New Page Component** 
   - Create ExpiredItemsPage component
   - Implement table to display expired items with relevant information

2. **User Interface**
   - Add action buttons for "sold through" and "expired"
   - Implement modal or form for entering units to discard when marking as expired
   - Add validation for input fields

3. **Data Management**
   - Connect frontend to backend API endpoints
   - Implement state management for expired items

4. **Reporting Features**
   - Create sections or pages to display financial losses by SKU and store area

### Phase 3: Integration & Testing
1. **Integration Testing**
   - Test the complete flow of marking expired items
   - Verify financial calculations
   - Ensure audit trail is properly recorded

2. **Offline Functionality**
   - Ensure the feature works when offline
   - Test synchronization when connectivity is restored

3. **Performance Testing**
   - Ensure the page loads efficiently with large number of expired items

## Database Changes
The current database schema already has the `inventory_items` table with status values that include "Expired". We'll need to determine if additional fields are needed to track expired item transactions.

### Potential New Table: expired_item_transactions
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `inventory_item_id`: INTEGER NOT NULL (foreign key to inventory_items)
- `user_id`: INTEGER NOT NULL (foreign key to users)
- `action`: TEXT NOT NULL (values: 'sold_through', 'expired')
- `units_discarded`: INTEGER (only required when action is 'expired')
- `financial_loss`: REAL (calculated as units_discarded * cost_price)
- `transaction_date`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
- FOREIGN KEY (user_id) REFERENCES users (id)

## API Endpoints
- GET `/expired-items` - Retrieve all expired inventory items
- POST `/expired-items/process` - Process expired item (mark as sold through or expired)
- GET `/reports/expired-losses` - Get financial loss reports by SKU and store area

## User Interface Components
1. **ExpiredItemsPage** - Main page displaying all expired items
2. **ProcessExpiredItemModal** - Modal for processing individual expired items
3. **ExpiredLossReport** - Component to display financial losses by SKU and store area

## Navigation
- Add link to "Expired Items" in the main navigation sidebar
- Ensure access is available to users with Manager role

## Testing Strategy
- Unit tests for backend business logic
- Integration tests for API endpoints
- UI tests for the new page components
- Test with various scenarios including edge cases for financial calculations
- Test offline functionality

## Risk Assessment
- Large number of expired items could impact performance
- Complex financial calculations need to be verified for accuracy
- Synchronization issues when processing items offline

## Success Criteria
- Users can easily view and process expired items
- Financial losses are accurately calculated and reported
- System maintains offline capability
- All changes are properly audited
- Performance remains acceptable with large datasets