export const BrowserRouter = ({ children }: { children: any }) => children;
export const Routes = ({ children }: { children: any }) => children;
export const Route = ({ path, element }: { path?: string; element: any }) => {
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
export const Link = ({ children }: { children: any }) => children;
export const Navigate = () => null;
export const useLocation = () => ({ pathname: '/' });
export const mockNavigate = jest.fn();
export const useNavigate = () => mockNavigate;
