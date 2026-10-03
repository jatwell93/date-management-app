// Artillery processor for custom logic.
//
// Functions here run only where artillery.yml names them: `requireBearerToken`
// from the top-level `before` flow, `countAuthRejections` from each
// authenticated request's `afterResponse`.

/**
 * Fails the run before any load is sent when there is no token for the
 * authenticated scenarios. Without one, every authenticated request is a 401
 * that never reaches a query, and a run that only measures rejections would
 * still pass the latency and error-rate thresholds.
 */
function requireBearerToken(context, events, done) {
  if (!process.env.LOAD_TEST_BEARER_TOKEN?.trim()) {
    return done(
      new Error(
        'LOAD_TEST_BEARER_TOKEN is required: a Clerk session JWT for the authenticated scenarios',
      ),
    );
  }
  return done();
}

/**
 * Counts authenticated requests the Worker rejected, so a token that expired
 * mid-run shows up in the report as `auth.rejected` instead of passing
 * silently as an accepted status.
 */
function countAuthRejections(requestParams, response, context, events, done) {
  if (response.statusCode === 401) {
    events.emit('counter', 'auth.rejected', 1);
  }
  return done();
}

module.exports = { requireBearerToken, countAuthRejections };
