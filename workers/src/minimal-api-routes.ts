import type { Database } from './database';
import type { Env } from './types/env';

type StaticApiHandler = (request: Request, db: Database, env: Env) => Promise<Response>;
type PathApiHandler = (
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
) => Promise<Response>;
type BootstrapApiHandler = (request: Request, env: Env) => Promise<Response>;

export type MinimalApiRouteHandlers = {
  handleLogin: StaticApiHandler;
  handleRegister: StaticApiHandler;
  handleGetCurrentUser: StaticApiHandler;
  handleListUsers: StaticApiHandler;
  handleCreateLegacyUser: StaticApiHandler;
  handleResetUserPin: StaticApiHandler;
  handleUpdateUser: PathApiHandler;
  handleDeleteUser: PathApiHandler;
  handleGetProducts: StaticApiHandler;
  handleCreateProduct: StaticApiHandler;
  handleGetProductByBarcode: PathApiHandler;
  handleGetProductBySku: PathApiHandler;
  handleGetProduct: PathApiHandler;
  handleGetInventory: StaticApiHandler;
  handleCreateInventoryItem: StaticApiHandler;
  handleGetInventoryByBarcode: PathApiHandler;
  handleGetRecentInventoryByProduct: PathApiHandler;
  handleUpdateInventoryItem: PathApiHandler;
  handleDeleteInventoryItem: PathApiHandler;
  handleGetStoreAreas: StaticApiHandler;
  handleCreateStoreArea: StaticApiHandler;
  handleUpdateStoreArea: PathApiHandler;
  handleDeleteStoreArea: PathApiHandler;
  handleGetDashboard: StaticApiHandler;
  handleGetExpiryReport: StaticApiHandler;
  handleGetExpiryOverallReport: StaticApiHandler;
  handleGetExpiryDetailsReport: StaticApiHandler;
  handleGetDailyUsageReport: StaticApiHandler;
  handleGetItemsByUserReport: StaticApiHandler;
  handleGetItemsByDateReport: StaticApiHandler;
  handleGetLossBySkuReport: StaticApiHandler;
  handleGetLossByDepartmentReport: StaticApiHandler;
  handleGetSellThroughReport: StaticApiHandler;
  handleGetExpiredItems: StaticApiHandler;
  handleProcessExpiredItem: StaticApiHandler;
  handleGetTrialStatus: StaticApiHandler;
  handleOrganizationBootstrap: BootstrapApiHandler;
};

type MinimalApiRouteContext = {
  request: Request;
  pathname: string;
  method: string;
  db: Database;
  env: Env;
  handlers: MinimalApiRouteHandlers;
};

type MinimalApiRoute = {
  method: string;
  path?: string;
  pattern?: RegExp;
  handler: keyof MinimalApiRouteHandlers;
  kind: 'static' | 'path' | 'bootstrap';
};

const MINIMAL_API_ROUTES: MinimalApiRoute[] = [
  { method: 'POST', path: '/api/auth/login', handler: 'handleLogin', kind: 'static' },
  { method: 'POST', path: '/api/auth/register', handler: 'handleRegister', kind: 'static' },
  { method: 'GET', path: '/api/users/me', handler: 'handleGetCurrentUser', kind: 'static' },
  { method: 'GET', path: '/api/users', handler: 'handleListUsers', kind: 'static' },
  { method: 'POST', path: '/api/users', handler: 'handleCreateLegacyUser', kind: 'static' },
  {
    method: 'PUT',
    pattern: /^\/api\/users\/\d+\/reset-pin$/,
    handler: 'handleResetUserPin',
    kind: 'static',
  },
  { method: 'PUT', pattern: /^\/api\/users\/\d+$/, handler: 'handleUpdateUser', kind: 'path' },
  { method: 'DELETE', pattern: /^\/api\/users\/\d+$/, handler: 'handleDeleteUser', kind: 'path' },
  { method: 'GET', path: '/api/products', handler: 'handleGetProducts', kind: 'static' },
  { method: 'POST', path: '/api/products', handler: 'handleCreateProduct', kind: 'static' },
  {
    method: 'GET',
    pattern: /^\/api\/products\/by-barcode\/[^/]+$/,
    handler: 'handleGetProductByBarcode',
    kind: 'path',
  },
  {
    method: 'GET',
    pattern: /^\/api\/products\/by-sku\/[^/]+$/,
    handler: 'handleGetProductBySku',
    kind: 'path',
  },
  { method: 'GET', pattern: /^\/api\/products\/\d+$/, handler: 'handleGetProduct', kind: 'path' },
  { method: 'GET', path: '/api/inventory-items', handler: 'handleGetInventory', kind: 'static' },
  {
    method: 'POST',
    path: '/api/inventory-items',
    handler: 'handleCreateInventoryItem',
    kind: 'static',
  },
  {
    method: 'GET',
    pattern: /^\/api\/inventory-items\/by-barcode\/[^/]+$/,
    handler: 'handleGetInventoryByBarcode',
    kind: 'path',
  },
  {
    method: 'GET',
    pattern: /^\/api\/inventory-items\/recent\/product\/\d+$/,
    handler: 'handleGetRecentInventoryByProduct',
    kind: 'path',
  },
  {
    method: 'PUT',
    pattern: /^\/api\/inventory-items\/\d+$/,
    handler: 'handleUpdateInventoryItem',
    kind: 'path',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/inventory-items\/\d+$/,
    handler: 'handleDeleteInventoryItem',
    kind: 'path',
  },
  { method: 'GET', path: '/api/store-areas', handler: 'handleGetStoreAreas', kind: 'static' },
  { method: 'POST', path: '/api/store-areas', handler: 'handleCreateStoreArea', kind: 'static' },
  {
    method: 'PUT',
    pattern: /^\/api\/store-areas\/\d+$/,
    handler: 'handleUpdateStoreArea',
    kind: 'path',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/store-areas\/\d+$/,
    handler: 'handleDeleteStoreArea',
    kind: 'path',
  },
  { method: 'GET', path: '/api/dashboard', handler: 'handleGetDashboard', kind: 'static' },
  { method: 'GET', path: '/api/reports/expiry', handler: 'handleGetExpiryReport', kind: 'static' },
  {
    method: 'GET',
    path: '/api/reports/expiry-overall',
    handler: 'handleGetExpiryOverallReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/expiry-details',
    handler: 'handleGetExpiryDetailsReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/daily-usage',
    handler: 'handleGetDailyUsageReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/items-by-user',
    handler: 'handleGetItemsByUserReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/items-by-date',
    handler: 'handleGetItemsByDateReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/loss-by-sku',
    handler: 'handleGetLossBySkuReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/loss-by-department',
    handler: 'handleGetLossByDepartmentReport',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/reports/sell-through',
    handler: 'handleGetSellThroughReport',
    kind: 'static',
  },
  { method: 'GET', path: '/api/expired-items', handler: 'handleGetExpiredItems', kind: 'static' },
  {
    method: 'POST',
    path: '/api/expired-items/process',
    handler: 'handleProcessExpiredItem',
    kind: 'static',
  },
  {
    method: 'GET',
    path: '/api/subscription/trial-status',
    handler: 'handleGetTrialStatus',
    kind: 'static',
  },
  {
    method: 'POST',
    path: '/api/organization/bootstrap',
    handler: 'handleOrganizationBootstrap',
    kind: 'bootstrap',
  },
];

function matchesRoute(route: MinimalApiRoute, method: string, pathname: string): boolean {
  if (route.method !== method) return false;
  if (route.path) return route.path === pathname;
  return route.pattern?.test(pathname) ?? false;
}

export async function resolveMinimalApiRoute({
  request,
  pathname,
  method,
  db,
  env,
  handlers,
}: MinimalApiRouteContext): Promise<Response | null> {
  const route = MINIMAL_API_ROUTES.find((candidate) => matchesRoute(candidate, method, pathname));
  if (!route) return null;

  const handler = handlers[route.handler];
  if (!handler) return null;

  if (route.kind === 'bootstrap') {
    return (handler as BootstrapApiHandler)(request, env);
  }

  if (route.kind === 'path') {
    return (handler as PathApiHandler)(request, db, env, pathname);
  }

  return (handler as StaticApiHandler)(request, db, env);
}
