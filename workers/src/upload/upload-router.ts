import type { Database } from '../database';
import type { Env } from '../types/env';
import { errorResponse } from '../utils/worker-response';

export type WorkerUploadHandlers = {
  handleUploadInitiate: (
    request: Request,
    env: Env,
    uploadRouteBase: '/upload' | '/api/upload',
    db: Database,
  ) => Promise<Response>;
  handleUploadDirect: (
    request: Request,
    env: Env,
    key: string,
    db: Database,
  ) => Promise<Response>;
  handleUploadPresigned: (
    request: Request,
    env: Env,
    key: string,
    uploadToken: string | null,
  ) => Promise<Response>;
  handleUploadStatus: (
    request: Request,
    env: Env,
    key: string,
    db: Database,
  ) => Promise<Response>;
  handleUploadErrorReport: (
    request: Request,
    env: Env,
    key: string,
    db: Database,
  ) => Promise<Response>;
  handleUploadComplete: (request: Request, env: Env, db: Database) => Promise<Response>;
};

export type WorkerUploadRouteContext = {
  request: Request;
  env: Env;
  url: URL;
  pathname: string;
  method: string;
  requestOrigin: string;
  getDb: () => Database;
  handlers: WorkerUploadHandlers;
};

function decodeUploadRouteKey(
  pathname: string,
  prefix: string,
  env: Env,
  requestOrigin: string,
): string | Response {
  const encodedKey = pathname.slice(prefix.length);
  if (!encodedKey) {
    return errorResponse('Missing key in URL', 400, env, requestOrigin);
  }

  try {
    return decodeURIComponent(encodedKey);
  } catch {
    return errorResponse('Invalid key encoding', 400, env, requestOrigin);
  }
}

type KeyedUploadRoute = {
  method: string;
  suffix: string;
  handler: (
    handlers: WorkerUploadHandlers,
    request: Request,
    env: Env,
    key: string,
    db: Database,
    url: URL,
  ) => Promise<Response>;
};

const KEYED_UPLOAD_ROUTES: KeyedUploadRoute[] = [
  {
    method: 'POST',
    suffix: '/direct/',
    handler: (handlers, request, env, key, db) =>
      handlers.handleUploadDirect(request, env, key, db),
  },
  {
    method: 'PUT',
    suffix: '/presigned/',
    handler: (handlers, request, env, key, _db, url) =>
      handlers.handleUploadPresigned(request, env, key, url.searchParams.get('token')),
  },
  {
    method: 'GET',
    suffix: '/status/',
    handler: (handlers, request, env, key, db) =>
      handlers.handleUploadStatus(request, env, key, db),
  },
  {
    method: 'GET',
    suffix: '/error-report/',
    handler: (handlers, request, env, key, db) =>
      handlers.handleUploadErrorReport(request, env, key, db),
  },
];

export async function handleWorkerUploadRoute({
  request,
  env,
  url,
  pathname,
  method,
  requestOrigin,
  getDb,
  handlers,
}: WorkerUploadRouteContext): Promise<Response | null> {
  const uploadRouteBase = pathname.startsWith('/api/upload') ? '/api/upload' : '/upload';

  if (method === 'POST' && pathname === `${uploadRouteBase}/initiate`) {
    return handlers.handleUploadInitiate(request, env, uploadRouteBase, getDb());
  }

  for (const route of KEYED_UPLOAD_ROUTES) {
    const prefix = `${uploadRouteBase}${route.suffix}`;
    if (method === route.method && pathname.startsWith(prefix)) {
      const key = decodeUploadRouteKey(pathname, prefix, env, requestOrigin);
      return key instanceof Response
        ? key
        : route.handler(handlers, request, env, key, getDb(), url);
    }
  }

  if (method === 'POST' && pathname === `${uploadRouteBase}/complete`) {
    return handlers.handleUploadComplete(request, env, getDb());
  }

  return null;
}
