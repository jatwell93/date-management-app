// Artillery processor for custom logic
module.exports = {
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
