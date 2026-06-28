// Vitest global setup for the Neon/PostgreSQL variant.
//
// jest.config.neon.js used two separate hooks (globalSetup + globalTeardown);
// Vitest takes a single global-setup module that exports named `setup` and
// `teardown` functions. We reuse the existing jest scripts verbatim:
//   - test-setup-neon.js     swaps the Prisma schema to Postgres and `db push`es
//   - test-teardown-neon.js  stops monitoring, disconnects, restores the schema
module.exports = {
  setup: require('./test-setup-neon'),
  teardown: require('./test-teardown-neon'),
};
