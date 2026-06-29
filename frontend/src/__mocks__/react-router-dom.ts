import type { ReactNode } from 'react';

export const BrowserRouter = ({ children }: { children: ReactNode }) => children;
export const Routes = ({ children }: { children: ReactNode }) => children;
export const Route = ({ path, element }: { path?: string; element: ReactNode }) => {
  const pathname = window.location.pathname;

  if (!path || path === '*') {
    return null;
  }

  if (path.endsWith('/*')) {
    const basePath = path.slice(0, -2);
    return pathname.startsWith(`${basePath}/`) ? element : null;
  }

  return pathname === path ? element : null;
};
export const Link = ({ children }: { children: ReactNode }) => children;
export const Navigate = () => null;
export const useLocation = () => ({ pathname: '/' });
export const mockNavigate = vi.fn();
export const useNavigate = () => mockNavigate;
