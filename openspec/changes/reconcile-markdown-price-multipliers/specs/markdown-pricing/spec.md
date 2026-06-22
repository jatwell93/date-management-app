## ADDED Requirements

### Requirement: Markdown price is a single discount ladder across the app

The system SHALL compute the reduced price of marked-down stock from one discount ladder applied to
the item's cost, so the price shown to staff and customers matches the price any backend path
computes for the same item. The ladder, keyed to days-to-expiry, is: Markdown 1 (61-90 days) = 50%
off, Markdown 2 (31-60 days) = 60% off, Markdown 3 (0-30 days) = 75% off; items more than 90 days
from expiry have no markdown price.

#### Scenario: First markdown reduces, never increases, the price

- **GIVEN** an item 80 days from its used-by date (Markdown 1 window) with a cost of 10
- **WHEN** its markdown price is computed on the backend
- **THEN** the price is 5.00 (50% off)
- **AND** it is never greater than the cost

#### Scenario: Deepest markdown matches the customer-facing discount

- **GIVEN** an item 20 days from its used-by date (Markdown 3 window) with a cost of 10
- **WHEN** its markdown price is computed on the backend
- **THEN** the price is 2.50 (75% off), equal to the price the Scan page shows for the same item

#### Scenario: No markdown outside the window

- **GIVEN** an item more than 90 days from its used-by date
- **WHEN** its markdown price is computed
- **THEN** no markdown price is returned
