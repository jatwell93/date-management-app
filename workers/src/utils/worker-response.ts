import type { Env } from '../types/env';

const COMPRESSION_MIN_BYTES = 1024;

export function getCorsHeaders(env: Env, requestOrigin?: string): HeadersInit {
  const allowAll = env.NODE_ENV !== 'production' || !env.FRONTEND_URL;
  const allowedOrigin = allowAll
    ? requestOrigin || '*'
    : env.FRONTEND_URL || 'http://localhost:3000';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { 'Access-Control-Allow-Credentials': 'true' }),
  };
}

export function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(env, origin),
  });
}

export function jsonResponse(
  data: unknown,
  status = 200,
  env?: Env,
  requestOrigin?: string,
): Response {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(env ? getCorsHeaders(env, requestOrigin) : {}),
  };

  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(
  message: string,
  status = 500,
  env?: Env,
  requestOrigin?: string,
): Response {
  return jsonResponse({ error: message }, status, env, requestOrigin);
}

export function applyCorsHeaders(
  response: Response,
  env: Env,
  requestOrigin?: string,
): Response {
  if (response.headers.has('Access-Control-Allow-Origin')) {
    return response;
  }

  const corsHeaders = getCorsHeaders(env, requestOrigin) as Record<string, string>;
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    merged.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

function requestSupportsGzip(request: Request): boolean {
  const acceptEncoding = request.headers.get('Accept-Encoding') || '';
  return acceptEncoding.toLowerCase().includes('gzip');
}

function appendVaryHeader(headers: Headers, value: string): void {
  const existing = headers.get('Vary');

  if (!existing) {
    headers.set('Vary', value.toLowerCase());
    return;
  }

  const values = existing
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  const newValue = value.toLowerCase();

  if (!values.includes(newValue)) {
    values.push(newValue);
  }

  headers.set('Vary', values.join(', '));
}

export async function maybeCompressJsonResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!requestSupportsGzip(request)) {
    return response;
  }

  if (request.method === 'HEAD') {
    return response;
  }

  if (!response.body) {
    return response;
  }

  if (response.headers.has('Content-Encoding')) {
    return response;
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return response;
  }

  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength < COMPRESSION_MIN_BYTES) {
    return new Response(rawBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const stream = new Blob([rawBody]).stream().pipeThrough(new CompressionStream('gzip'));
  const headers = new Headers(response.headers);
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');
  appendVaryHeader(headers, 'Accept-Encoding');

  return new Response(stream, {
    encodeBody: 'manual',
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
