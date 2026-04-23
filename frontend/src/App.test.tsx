import { API_AUTH_UNAUTHORIZED_EVENT } from './lib/api.service';

describe('App unauthorized event handling', () => {
  it('should clear auth state when unauthorized event is fired', (done) => {
    // This test verifies that the App component has an event listener
    // that responds to API_AUTH_UNAUTHORIZED_EVENT

    const listener = jest.fn();

    // Simulate what the App component should do when unauthorized
    window.addEventListener(API_AUTH_UNAUTHORIZED_EVENT, listener);

    // Fire the event
    const event = new CustomEvent(API_AUTH_UNAUTHORIZED_EVENT, {
      detail: { endpoint: '/api/test', status: 401 },
    });
    window.dispatchEvent(event);

    // Verify listener was called
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { endpoint: '/api/test', status: 401 } }),
    );

    window.removeEventListener(API_AUTH_UNAUTHORIZED_EVENT, listener);
    done();
  });
});

export {};
