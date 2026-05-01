# Standardize on camelCase Field Names

## Overview
This document outlines the long-term plan to standardize all API field names to camelCase format, eliminating the current dual-support for both camelCase and snake_case conventions.

## Current State
- Frontend interfaces use camelCase (`productId`, `expiryDate`, `locationId`)
- Backend supports both camelCase and snake_case for backward compatibility
- Deprecation warnings are logged for snake_case usage
- Technical debt exists from maintaining dual field naming support

## Migration Tasks

### Phase 1: Preparation and Planning
- [ ] **Audit all snake_case usage across the codebase**
  - Search for `product_id`, `expiry_date`, `location_id` in all files
  - Document all locations where snake_case is still used
  - Identify external integrations that may depend on snake_case

- [ ] **Create migration timeline**
  - Set deprecation deadline (e.g., 6 months from now)
  - Plan communication strategy for external API users
  - Schedule migration windows to minimize disruption

- [ ] **Add comprehensive monitoring**
  - Track deprecation warning frequency
  - Monitor which clients/versions use snake_case
  - Set up alerts for unexpected snake_case usage

### Phase 2: Internal Standardization
- [ ] **Update all internal code to use camelCase exclusively**
  - Frontend: Already complete ✅
  - Backend: Update all internal references to use camelCase
  - Tests: Ensure all test data uses camelCase
  - Documentation: Update API docs to show camelCase only

- [ ] **Remove snake_case from internal interfaces**
  - Update TypeScript interfaces to only include camelCase
  - Remove snake_case from database query results mapping
  - Clean up any remaining snake_case constants or helpers

- [ ] **Enhance validation and error messages**
  - Update error messages to reference camelCase field names
  - Add specific validation for deprecated snake_case fields
  - Improve API documentation with clear field naming guidelines

### Phase 3: External Migration Support
- [ ] **Implement versioned API endpoints**
  - Create `/v2/` endpoints that only accept camelCase
  - Maintain `/v1/` endpoints with backward compatibility during transition
  - Add API version headers and migration guides

- [ ] **Client migration tools and documentation**
  - Provide migration guides for external API users
  - Create code examples showing camelCase usage
  - Offer SDK updates with camelCase support

- [ ] **Gradual enforcement**
  - Start returning warnings for snake_case usage in production
  - Gradually increase severity (warning → error → rejection)
  - Provide clear migration deadlines in error messages

### Phase 4: Cleanup and Removal
- [ ] **Remove snake_case support completely**
  - Remove backward compatibility code from `index-minimal.ts`
  - Delete snake_case field mapping logic
  - Remove deprecation warning code

- [ ] **Decommission v1 endpoints**
  - Redirect v1 endpoints to v2 with migration notices
  - Eventually remove v1 endpoints after deadline
  - Update all API documentation to reference v2 only

- [ ] **Final cleanup**
  - Remove any remaining snake_case references
  - Update integration tests to verify snake_case rejection
  - Archive migration documentation

## Implementation Details

### Files to Update
- `workers/src/index-minimal.ts` - Remove snake_case backward compatibility
- `backend/src/handlers/inventory.ts` - Update field handling
- All API documentation - Update to show camelCase only
- Integration tests - Verify snake_case rejection

### Monitoring Requirements
- Track deprecation warning frequency
- Monitor API client versions and field naming usage
- Set up alerts for unexpected snake_case usage after deadline

### Risk Mitigation
- Gradual phase-out approach to avoid breaking changes
- Clear communication with external API users
- Comprehensive testing before each phase
- Rollback plan for each phase

## Success Criteria
- [ ] All internal code uses camelCase exclusively
- [ ] No deprecation warnings in production for 30 days
- [ ] External API users have migrated to camelCase
- [ ] All snake_case support code removed
- [ ] API documentation updated and consistent
- [ ] Tests pass with camelCase-only implementation

## Timeline
- **Phase 1**: 2 weeks (Audit and planning)
- **Phase 2**: 4 weeks (Internal standardization)
- **Phase 3**: 8 weeks (External migration support)
- **Phase 4**: 2 weeks (Cleanup and removal)
- **Total**: 16 weeks (4 months)

## Dependencies
- External API user cooperation for migration
- Sufficient testing coverage for changes
- Documentation updates completed in parallel
- Monitoring infrastructure in place

## Notes
- This migration aligns with modern JavaScript/TypeScript conventions
- CamelCase is already the standard in the frontend codebase
- Removing dual support will reduce maintenance overhead
- Clear communication with external users is critical for success
