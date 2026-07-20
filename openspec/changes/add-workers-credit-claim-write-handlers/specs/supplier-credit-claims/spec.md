## ADDED Requirements

### Requirement: Credit-claim writes are available on the production Workers runtime

The system SHALL make the credit-claim write operations (supplier create/update, product-to-supplier
assignment, claim build, claim send, outcome recording, and follow-up send) available on the Workers
runtime with behavior identical to the backend runtime. Expected-credit and follow-up-schedule values
SHALL be computed from the shared credit-claim resolvers so both runtimes produce identical results.
Photo bytes SHALL be stored via the Workers object-storage bindings and claim emails SHALL be sent
via an HTTP email call, without relying on a runtime-incompatible upload middleware.

#### Scenario: A claim is built and sent on the Workers runtime

- **GIVEN** a supplier with a contact email and an eligible write-off, on the Workers runtime
- **WHEN** a user builds a claim with one line and sends it
- **THEN** the claim's status becomes sent and a verified send timestamp is recorded
- **AND** a first follow-up time is scheduled from the send time and the supplier's cadence

#### Scenario: Write results match the backend runtime

- **GIVEN** the same supplier policy and claim lines processed on the backend and the Workers runtime
- **WHEN** each runtime computes the claim's expected credit and next follow-up time
- **THEN** both runtimes produce identical values

#### Scenario: The unique one-write-off-per-line rule holds on the Workers runtime

- **GIVEN** a write-off already attached to a claim line, on the Workers runtime
- **WHEN** an attempt is made to attach the same write-off to another claim line
- **THEN** the attempt is rejected
