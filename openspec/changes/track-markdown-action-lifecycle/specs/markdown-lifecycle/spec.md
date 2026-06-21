## ADDED Requirements

### Requirement: Disposition events record the markdown level

When stock is dispositioned (sold through or written off), the system SHALL record the markdown
level computed from the item's days-to-expiry at the time of the event, so historical reporting can
distinguish stock that sold at each reduction depth from stock that was never reduced.

#### Scenario: Sold through while on Markdown 2

- **GIVEN** an active item whose used-by date is 45 days away (Markdown 2 window)
- **WHEN** a user records it as sold through
- **THEN** the disposition transaction stores markdown level 2
- **AND** the item status becomes Sold Through

#### Scenario: Written off after expiry

- **GIVEN** an item that is past its used-by date
- **WHEN** a user writes it off
- **THEN** the disposition transaction records the write-off with no markdown level
- **AND** the item status becomes Expired

### Requirement: Active markdown stock can be sold through

The system SHALL allow recording a sold-through disposition for active stock that is within the
markdown window, not only for stock already past its used-by date. Write-off SHALL remain restricted
to expired stock; removing an active record for damage or recall uses the existing item delete flow.

#### Scenario: Sold through before expiry

- **GIVEN** an active item 10 days from its used-by date (Markdown 3 window)
- **WHEN** a user records it as sold through from the markdown worklist
- **THEN** the disposition is accepted and recorded with markdown level 3

#### Scenario: Write-off not offered for active stock

- **GIVEN** an active item that has not yet reached its used-by date
- **WHEN** a user views it in the markdown worklist
- **THEN** write-off is not offered for that item
- **AND** the item can still be removed via the existing delete action

### Requirement: Monthly markdown worklist groups items by action

The expiry detail view SHALL group items needing attention into the steps of the markdown process:
stock newly entering the Markdown 1 window this month, stock already on a markdown that needs review,
and expired stock to write off; and SHALL allow recording a disposition inline.

#### Scenario: Worklist groups and actions

- **GIVEN** stock spread across the entering, already-reduced, and expired states
- **WHEN** a user opens the markdown worklist
- **THEN** items appear under the matching action group
- **AND** the user can record a sold-through or write-off disposition without leaving the view

### Requirement: Sell-through reporting by markdown level

The reporting page SHALL show how stock sold through across markdown levels so stores can identify
products that only sell once reduced.

#### Scenario: Sell-through by level

- **GIVEN** disposition history with sold-through events at different markdown levels
- **WHEN** a user opens the sell-through report
- **THEN** sold-through counts are broken down by markdown level
- **AND** products that predominantly sell only at deeper reductions are identifiable
