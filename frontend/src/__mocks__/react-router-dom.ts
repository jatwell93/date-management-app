export const BrowserRouter = ({ children }: { children: any }) => children;
export const Routes = ({ children }: { children: any }) => children;
export const Route = () => null;
export const Link = ({ children }: { children: any }) => children;
export const Navigate = () => null;
export const useLocation = () => ({ pathname: '/' });
export const useNavigate = () => jest.fn();
