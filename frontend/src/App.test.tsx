import { render, waitFor } from '@testing-library/react';
import App from './App';
import { API_AUTH_UNAUTHORIZED_EVENT } from './lib/api.service';
import { useAuthContext } from './components/ClerkAuthProvider';

jest.mock('./components/ClerkAuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

describe('App unauthorized event handling', () => {
  it('should call handleLogout when unauthorized event is fired', async () => {
    const handleLogout = jest.fn();

    (useAuthContext as jest.Mock).mockReturnValue({
      handleLogout,
    });

    render(<App />);

    window.dispatchEvent(
      new CustomEvent(API_AUTH_UNAUTHORIZED_EVENT, {
        detail: { endpoint: '/api/test', status: 401 },
      }),
    );

    await waitFor(() => {
      expect(handleLogout).toHaveBeenCalledTimes(1);
    });
  });
});

export { };
