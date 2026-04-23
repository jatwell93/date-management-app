import { render, waitFor } from '@testing-library/react';
import { API_AUTH_UNAUTHORIZED_EVENT } from './lib/api.service';
import { useAuthContext } from './components/ClerkAuthProvider';

jest.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: any }) => children,
  Routes: ({ children }: { children: any }) => children,
  Route: () => null,
  Link: ({ children }: { children: any }) => children,
  Navigate: () => null,
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => jest.fn(),
}));

jest.mock('./components/ClerkAuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

// Mock child page components to avoid their imports
jest.mock('./pages/ScanPage', () => ({
  ScanPage: () => null,
}));

const App = require('./App').default;

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
