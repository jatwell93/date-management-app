import { Request, Response } from 'express';

const rateLimitMock = jest.fn((options: unknown) => {
    const middleware = ((_req: Request, _res: Response, next?: () => void) => {
        if (next) {
            next();
        }
    }) as unknown as Record<string, unknown>;

    middleware.__options = options;
    return middleware;
});

const ipKeyGeneratorMock = jest.fn((ip: string) => `normalized:${ip}`);

jest.mock('express-rate-limit', () => ({
    __esModule: true,
    default: (options: unknown) => rateLimitMock(options),
    ipKeyGenerator: (ip: string) => ipKeyGeneratorMock(ip),
}));

jest.mock('../../utils/logger', () => ({
    Logger: {
        warn: jest.fn(),
    },
}));

import { Logger } from '../../utils/logger';
import {
    globalLimiter,
    presignedUrlLimiter,
    skipRateLimitForIps,
    skipRateLimitForPaths,
    standardLimiter,
    strictLimiter,
    trialConversionLimiter,
    uploadLimiter,
} from '../../middleware/rateLimiter';

type LimiterWithOptions = {
    __options: {
        handler: (req: Request, res: Response) => void;
        keyGenerator?: (req: Request) => string;
    };
};

const getLimiterOptions = (limiter: unknown) => (limiter as LimiterWithOptions).__options;

const createRequest = (overrides: Record<string, unknown> = {}) =>
    ({
        headers: {},
        ip: '127.0.0.1',
        path: '/api/test',
        method: 'GET',
        ...overrides,
    }) as Request;

const createResponse = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res as Response);
    res.json = jest.fn().mockReturnValue(res as Response);
    res.setHeader = jest.fn().mockReturnValue(res as Response);

    return res as Response & {
        status: jest.Mock;
        json: jest.Mock;
        setHeader: jest.Mock;
    };
};

describe('rateLimiter middleware configuration', () => {
    beforeEach(() => {
        (Logger.warn as jest.Mock).mockClear();
        ipKeyGeneratorMock.mockClear();
    });

    it('builds all limiter instances through express-rate-limit', () => {
        expect(getLimiterOptions(standardLimiter)).toBeDefined();
        expect(getLimiterOptions(strictLimiter)).toBeDefined();
        expect(getLimiterOptions(uploadLimiter)).toBeDefined();
        expect(getLimiterOptions(globalLimiter)).toBeDefined();
        expect(getLimiterOptions(presignedUrlLimiter)).toBeDefined();
        expect(getLimiterOptions(trialConversionLimiter)).toBeDefined();
    });

    it('standard limiter handler logs and returns retryAfter ISO when reset is numeric', () => {
        const options = getLimiterOptions(standardLimiter);
        const resetTime = Date.now() + 30_000;
        const req = createRequest({
            headers: { 'x-forwarded-for': '198.51.100.4' },
            path: '/inventory-items',
            method: 'POST',
            rateLimit: { resetTime },
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Rate limit exceeded (standard)', {
            ip: '198.51.100.4',
            endpoint: '/inventory-items',
            method: 'POST',
        });
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP, please try again later.',
            retryAfter: new Date(resetTime).toISOString(),
        });
    });

    it('strict limiter uses date reset time and returns retryAfter ISO', () => {
        const options = getLimiterOptions(strictLimiter);
        const resetTime = new Date('2030-06-01T10:00:00.000Z');
        const req = createRequest({
            headers: { 'x-forwarded-for': '198.51.100.5' },
            path: '/auth/login',
            method: 'POST',
            rateLimit: { resetTime },
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Rate limit exceeded (strict)', {
            ip: '198.51.100.5',
            endpoint: '/auth/login',
            method: 'POST',
        });
        expect(res.json).toHaveBeenCalledWith({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many login attempts, please try again later.',
            retryAfter: resetTime.toISOString(),
        });
    });

    it('upload limiter returns undefined retryAfter when reset time is missing', () => {
        const options = getLimiterOptions(uploadLimiter);
        const req = createRequest({
            headers: { 'x-forwarded-for': '198.51.100.6' },
            path: '/upload',
            method: 'POST',
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Rate limit exceeded (upload)', {
            ip: '198.51.100.6',
            endpoint: '/upload',
            method: 'POST',
        });
        expect(res.json).toHaveBeenCalledWith({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many uploads from this IP, please try again later.',
            retryAfter: undefined,
        });
    });

    it('trial conversion limiter logs and returns 429 payload', () => {
        const options = getLimiterOptions(trialConversionLimiter);
        const req = createRequest({
            headers: { 'x-forwarded-for': '198.51.100.7' },
            path: '/convert-trial',
            method: 'POST',
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Rate limit exceeded (trial conversion)', {
            ip: '198.51.100.7',
            endpoint: '/convert-trial',
            method: 'POST',
        });
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many trial conversion attempts, please try again later.',
            retryAfter: undefined,
        });
    });

    it('global limiter does not log and returns generic payload', () => {
        const options = getLimiterOptions(globalLimiter);
        const req = createRequest({ path: '/health' });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP, please try again later.',
        });
    });

    it('skipRateLimitForIps handles forwarded and direct IPs', () => {
        const shouldSkip = skipRateLimitForIps(['203.0.113.10', '198.51.100.20']);

        const forwardedReq = createRequest({
            headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.5' },
            ip: '198.51.100.1',
        });
        const directReq = createRequest({
            headers: {},
            ip: '198.51.100.20',
        });
        const deniedReq = createRequest({
            headers: {},
            ip: '192.0.2.5',
        });

        expect(shouldSkip(forwardedReq)).toBe(true);
        expect(shouldSkip(directReq)).toBe(true);
        expect(shouldSkip(deniedReq)).toBe(false);
    });

    it('skipRateLimitForPaths matches prefix-only paths', () => {
        const shouldSkip = skipRateLimitForPaths(['/health', '/public']);

        expect(shouldSkip(createRequest({ path: '/health' }))).toBe(true);
        expect(shouldSkip(createRequest({ path: '/public/status' }))).toBe(true);
        expect(shouldSkip(createRequest({ path: '/private/status' }))).toBe(false);
    });

    it('presigned limiter keyGenerator uses organization and user when authenticated', () => {
        const options = getLimiterOptions(presignedUrlLimiter);
        const keyGenerator = options.keyGenerator as (req: Request) => string;

        const req = createRequest({
            organizationId: 'org-123',
            userId: 77,
            ip: '192.0.2.8',
        });

        const key = keyGenerator(req);

        expect(key).toBe('presigned-url:org-123:77');
        expect(ipKeyGeneratorMock).not.toHaveBeenCalled();
    });

    it('presigned limiter keyGenerator falls back to forwarded IP normalization', () => {
        const options = getLimiterOptions(presignedUrlLimiter);
        const keyGenerator = options.keyGenerator as (req: Request) => string;

        const req = createRequest({
            headers: { 'x-forwarded-for': '2001:db8::1, 192.0.2.9' },
            ip: '192.0.2.8',
        });

        const key = keyGenerator(req);

        expect(ipKeyGeneratorMock).toHaveBeenCalledWith('2001:db8::1');
        expect(key).toBe('presigned-url:ip:normalized:2001:db8::1');
    });

    it('presigned limiter keyGenerator falls back to req.ip when no forwarded header', () => {
        const options = getLimiterOptions(presignedUrlLimiter);
        const keyGenerator = options.keyGenerator as (req: Request) => string;

        const req = createRequest({
            headers: {},
            ip: '198.51.100.33',
        });

        const key = keyGenerator(req);

        expect(ipKeyGeneratorMock).toHaveBeenCalledWith('198.51.100.33');
        expect(key).toBe('presigned-url:ip:normalized:198.51.100.33');
    });

    it('presigned limiter handler computes retryAfter from Date reset time', () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
        const options = getLimiterOptions(presignedUrlLimiter);
        const req = createRequest({
            organizationId: 'org-1',
            userId: 9,
            headers: { 'x-forwarded-for': '198.51.100.99' },
            path: '/upload/presigned-url',
            method: 'POST',
            rateLimit: { resetTime: new Date(31_000) },
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Presigned URL rate limit exceeded', {
            organizationId: 'org-1',
            userId: 9,
            ip: '198.51.100.99',
            endpoint: '/upload/presigned-url',
            method: 'POST',
            timestamp: expect.any(String),
        });
        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '21');
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'ERR_RATE_LIMIT_EXCEEDED',
                retryAfter: 21,
                details: {
                    limit: 50,
                    window: '1 hour',
                    type: 'presigned_url_generation',
                },
            }),
        );

        nowSpy.mockRestore();
    });

    it('presigned limiter handler computes retryAfter from numeric reset time', () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(20_000);
        const options = getLimiterOptions(presignedUrlLimiter);
        const req = createRequest({
            organizationId: 'org-2',
            userId: 13,
            rateLimit: { resetTime: 28_100 },
        });
        const res = createResponse();

        options.handler(req, res);

        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '9');
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                retryAfter: 9,
            }),
        );

        nowSpy.mockRestore();
    });

    it('presigned limiter handler defaults retryAfter when reset time is missing', () => {
        const options = getLimiterOptions(presignedUrlLimiter);
        const req = createRequest({
            headers: {},
            path: '/upload/presigned-url',
            method: 'POST',
        });
        const res = createResponse();

        options.handler(req, res);

        expect(Logger.warn).toHaveBeenCalledWith('Presigned URL rate limit exceeded', {
            organizationId: 'unknown',
            userId: 'unauthenticated',
            ip: '127.0.0.1',
            endpoint: '/upload/presigned-url',
            method: 'POST',
            timestamp: expect.any(String),
        });
        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                retryAfter: 3600,
            }),
        );
    });
});
