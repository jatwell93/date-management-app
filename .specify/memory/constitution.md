# Pharma Date Manager Constitution
# Constitution
## Core Principles

### I. Mobile-First Progressive Web Application
All features must be designed for mobile devices as the primary interface. The application must work reliably on smartphones for barcode scanning, data entry, and inventory management. Progressive Web App (PWA) capabilities are mandatory to ensure offline functionality and native app-like experience for store teams.

### II. Data Integrity Above All (NON-NEGOTIABLE)
Data accuracy is paramount for business operations. Every feature involving:
- Expiry date calculations
- Markdown percentage calculations (item cost +20%, cost, cost -20%)
- SKU and barcode data matching
- Cost calculations and retail price adjustments

Must include comprehensive validation, error handling, and verification mechanisms. No exceptions!

### III. Web Standards and TypeScript Excellence
All code must follow modern web standards using TypeScript for type safety and React for component architecture. Code must be production-ready with proper error boundaries, loading states, and user feedback mechanisms.

### IV. Offline-First Architecture
The application must function without internet connectivity. Local data synchronization, cached product databases, and offline barcode scanning are essential for daily store operations.

### V. Automated Backup and Recovery (NON-NEGOTIABLE)
Data loss prevention through:
- Automated daily backups of all inventory data
- Export functionality for critical data
- Recovery procedures for corrupted data
- Version control for database schema changes

### VI. Production-Quality Testing
All features require comprehensive testing coverage:
- Unit tests for calculation logic (markdown percentages, expiry calculations)
- Integration tests for barcode scanning accuracy
- Data integrity tests for SKU matching and product lookups
- Mobile device compatibility testing across different screen sizes

### VII. Task-Based Development with AI Assistance (NON-NEGOTIABLE)
Every feature development follows structured task completion:
- Each task (T001, T002, etc.) must be completed with Gemini CLI assistance
- Structured commit messages for every completed task
- Documentation of AI-assisted learning and implementation decisions
- Code reviews focus on both functionality and learning outcomes

**Commit-Template**: Use structured commit messages for ALL commits:
```
T[XXX]: [Brief task description]

- Feature/fix implemented with AI assistance
- Key learning points or decisions made
- Testing approach and results
- Any production considerations addressed
```

### VIII. Deployment and Maintenance Strategy
Updates and deployment must consider business continuity:
- Staged rollouts with rollback capabilities
- User training documentation for new features
- Maintenance windows scheduled during non-business hours
- Feature flags for gradual feature rollouts

**IX. MCP-Enhanced Development Workflow (NON-NEGOTIABLE)**

All development must leverage the configured MCP servers for maximum efficiency and consistency:

**Ref Tools Integration:**

*   Documentation searches must use ref/search_documentation for TypeScript, React, PWA, and database guidance
    
*   Code examples and best practices retrieved via ref/read_url for implementation reference
    
*   Private documentation access for project-specific patterns and decisions
    

**ShadCN UI Integration:**

*   UI components must be sourced from shadcn-ui MCP server using list_components and get_component
    
*   Mobile-responsive patterns implemented using available blocks via list_blocks and get_block
    
*   Form components, data tables, and navigation patterns prioritized from the component library

## Governance

### Development Standards
- Constitution supersedes all other practices
- All PRs must verify mobile functionality, data integrity, and offline capabilities
- TypeScript strict mode is mandatory
- React best practices must be followed
- PWA requirements must be met

### Quality Assurance
- Manual testing on actual mobile devices required before deployment
- Barcode scanning accuracy validation mandatory
- Data calculation verification against existing spreadsheet system
- Performance testing on low-end devices

### Change Management
- Any amendments require documentation of business impact
- Database schema changes require migration plans and rollback procedures
- User interface changes require user acceptance testing with store teams
- All deviations from core principles require explicit documentation and approval

### Business Continuity
- Backup verification testing monthly
- Disaster recovery procedures documented and tested
- Alternative workflows documented for system downtime
- Store team training materials maintained and updated

## Success Metrics
- Zero data loss incidents
- 99%+ barcode scanning accuracy
- <3 second load times on mobile devices
- Successful offline operation for minimum 8 hours
- User adoption rate by store teams >90%

### Amendment Process
Constitutional changes require documentation of impact, approval from project stakeholders, and migration plan for existing implementations. Version control tracks all constitutional modifications.

#### Amendment History
- **v1.0.0** (2025-09-21): Initial constitution ratification with contract-first development principles
- **v1.0.1** (2025-09-21): Updated to instruct LLM to use MCP servers for shadcn-ui and ref tools

**Version**: 1.0.1 | **Ratified**: 2025-09-21 | **Last Amended**: 2025-09-21


