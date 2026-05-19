// Artillery processor for custom logic
module.exports = {
  // Setup function called once
  beforeScenario: function (userContext, events, done) {
    // Set default email/password if not provided from CSV
    if (!userContext.vars.email) {
      userContext.vars.email = 'loadtest@example.com';
    }
    if (!userContext.vars.password) {
      if (!process.env.TEST_PASSWORD) {
        return done(new Error('TEST_PASSWORD is required for load test scenarios'));
      }
      userContext.vars.password = process.env.TEST_PASSWORD;
    }
    return done();
  },

  // Custom function to log response times
  afterResponse: function (requestParams, response, userContext, events, done) {
    // Add custom metrics
    if (response.statusCode >= 500) {
      events.emit('counter', 'errors.server', 1);
    } else if (response.statusCode >= 400) {
      events.emit('counter', 'errors.client', 1);
    }
    return done();
  },
};
