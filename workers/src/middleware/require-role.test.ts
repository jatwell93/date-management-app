import { describe, it, expect, vi } from 'vitest';
import { createUploadRoleMiddleware, createRequireRoleMiddleware } from './require-role.middleware';
import { ExpressRequest, ExpressResponse } from '../express-adapter';
import { ROLES } from '../constants/roles';

function createMockReq(overrides: Partial<ExpressRequest> = {}): ExpressRequest {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    method: 'POST',
    url: '/api/uploads/csv',
    path: '/api/uploads/csv',
    ip: '127.0.0.1',
    get: () => undefined,
    ...overrides,
  } as ExpressRequest;
}

function createMockRes(): { res: ExpressResponse; getStatus: () => number; getBody: () => any } {
  let statusCode = 200;
  let body: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
    },
    setHeader() {},
    isSent: () => body !== null,
  } as unknown as ExpressResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe('createUploadRoleMiddleware', () => {
  const middleware = createUploadRoleMiddleware();

  it('allows admin POST to upload endpoint', () => {
    const req = createMockReq({ userRole: 'admin', path: '/api/uploads/csv' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('allows manager POST to upload endpoint', () => {
    const req = createMockReq({ userRole: 'manager', path: '/api/uploads/csv' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('blocks team_member POST to upload endpoint with 403', () => {
    const req = createMockReq({ userRole: 'team_member', path: '/api/uploads/csv' });
    const { res, getStatus, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getStatus()).toBe(403);
    expect(getBody().code).toBe('FORBIDDEN');
    expect(getBody().message).toContain('Insufficient permissions');
  });

  it('blocks missing role on upload endpoint with 403', () => {
    const req = createMockReq({ path: '/api/uploads/csv' });
    const { res, getStatus, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getStatus()).toBe(403);
    expect(getBody().code).toBe('FORBIDDEN');
  });

  it('allows team_member GET to upload endpoint (read-only)', () => {
    const req = createMockReq({ userRole: 'team_member', path: '/api/uploads/csv', method: 'GET' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('passes through non-upload paths regardless of role', () => {
    const req = createMockReq({ userRole: 'team_member', path: '/api/inventory-items' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('normalizes legacy Clerk role strings', () => {
    const req = createMockReq({ userRole: 'org:admin', path: '/api/uploads/csv' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
    expect(req.userRole).toBe('admin');
  });

  it.each([
    ['org:manager', true, 'manager'],
    ['org:member', false, 'team_member'],
    ['org:team_member', false, 'team_member'],
  ])(
    'handles Clerk role mapping for %s on upload POST',
    (clerkRole, shouldAllow, expectedCanonical) => {
      const req = createMockReq({ userRole: clerkRole, path: '/api/uploads/csv', method: 'POST' });
      const { res, getStatus, getBody } = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      if (shouldAllow) {
        expect(next).toHaveBeenCalled();
        expect(getBody()).toBeNull();
        expect(req.userRole).toBe(expectedCanonical);
        return;
      }

      expect(next).not.toHaveBeenCalled();
      expect(getStatus()).toBe(403);
      expect(getBody().code).toBe('FORBIDDEN');
    },
  );
});

describe('createRequireRoleMiddleware', () => {
  const middleware = createRequireRoleMiddleware([ROLES.ADMIN], ['/api/admin']);

  it('allows admin to admin-only path', () => {
    const req = createMockReq({ userRole: 'admin', path: '/api/admin/dashboard', method: 'POST' });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('blocks team_member from admin-only path', () => {
    const req = createMockReq({
      userRole: 'team_member',
      path: '/api/admin/dashboard',
      method: 'POST',
    });
    const { res, getStatus, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getStatus()).toBe(403);
    expect(getBody().code).toBe('FORBIDDEN');
  });

  it('passes through non-protected paths', () => {
    const req = createMockReq({
      userRole: 'team_member',
      path: '/api/inventory-items',
      method: 'POST',
    });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });

  it('allows GET requests on protected paths (read-only)', () => {
    const req = createMockReq({
      userRole: 'team_member',
      path: '/api/admin/dashboard',
      method: 'GET',
    });
    const { res, getBody } = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getBody()).toBeNull();
  });
});
