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

  if (method === 'POST' && pathname.startsWith(`${uploadRouteBase}/direct/`)) {
    const key = decodeUploadRouteKey(pathname, `${uploadRouteBase}/direct/`, env, requestOrigin);
    return key instanceof Response ? key : handlers.handleUploadDirect(request, env, key, getDb());
  }

  if (method === 'PUT' && pathname.startsWith(`${uploadRouteBase}/presigned/`)) {
    const key = decodeUploadRouteKey(pathname, `${uploadRouteBase}/presigned/`, env, requestOrigin);
    return key instanceof Response
      ? key
      : handlers.handleUploadPresigned(request, env, key, url.searchParams.get('token'));
  }

  if (method === 'GET' && pathname.startsWith(`${uploadRouteBase}/status/`)) {
    const key = decodeUploadRouteKey(pathname, `${uploadRouteBase}/status/`, env, requestOrigin);
    return key instanceof Response ? key : handlers.handleUploadStatus(request, env, key, getDb());
  }

  if (method === 'GET' && pathname.startsWith(`${uploadRouteBase}/error-report/`)) {
    const key = decodeUploadRouteKey(
      pathname,
      `${uploadRouteBase}/error-report/`,
      env,
      requestOrigin,
    );
    return key instanceof Response
      ? key
      : handlers.handleUploadErrorReport(request, env, key, getDb());
  }

  if (method === 'POST' && pathname === `${uploadRouteBase}/complete`) {
    return handlers.handleUploadComplete(request, env, getDb());
  }

  return null;
}
