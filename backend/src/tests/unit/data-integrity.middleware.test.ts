import { NextFunction, Request, Response } from 'express';

const mockGetDb = jest.fn();
const mockReleaseDb = jest.fn();

jest.mock('../../database', () => ({
    getDb: (...args: unknown[]) => mockGetDb(...args),
    releaseDb: (...args: unknown[]) => mockReleaseDb(...args),
}));

import {
    validateBusinessRules,
    validateDataConsistency,
    validateReferentialIntegrity,
} from '../../middleware/data-integrity.middleware';

interface MockDb {
    prepare: jest.Mock;
}

const createRequest = (overrides: Partial<Request> = {}): Request =>
    ({
        path: '/inventory-items',
        method: 'POST',
        body: {},
        ...overrides,
    }) as Request;

const createResponse = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res as Response);
    res.json = jest.fn().mockReturnValue(res as Response);
    return res as Response & {
        status: jest.Mock;
        json: jest.Mock;
    };
};

describe('data-integrity middleware', () => {
    let db: MockDb;
    let next: jest.MockedFunction<NextFunction>;

    beforeEach(() => {
        db = { prepare: jest.fn() };
        mockGetDb.mockReturnValue(db);
        mockReleaseDb.mockClear();
        next = jest.fn();
    });

    describe('validateReferentialIntegrity', () => {
        it('returns 400 when inventory product reference is missing', async () => {
            db.prepare.mockReturnValueOnce({
                get: jest.fn().mockReturnValue(undefined),
            });

            const req = createRequest({ body: { productId: 999 } });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Referenced product does not exist' });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('returns 400 when inventory location reference is missing', async () => {
            db.prepare
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1 }) })
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue(undefined) });

            const req = createRequest({ body: { productId: 1, locationId: 333 } });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Referenced store location does not exist' });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('returns 400 when audit user reference is missing', async () => {
            db.prepare.mockReturnValueOnce({
                get: jest.fn().mockReturnValue(undefined),
            });

            const req = createRequest({
                path: '/audit-log',
                body: { user_id: 55 },
            });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Referenced user does not exist' });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('returns 400 when audit inventory item reference is missing', async () => {
            db.prepare
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 8 }) })
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue(undefined) });

            const req = createRequest({
                path: '/audit-log',
                body: { user_id: 8, inventory_item_id: 404 },
            });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Referenced inventory item does not exist' });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('calls next when references are valid or path is not targeted', async () => {
            db.prepare
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1 }) })
                .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 2 }) });

            const req = createRequest({ body: { productId: 1, locationId: 2 } });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);

            next.mockClear();
            const reqNotTargeted = createRequest({ path: '/products', method: 'GET' });
            await validateReferentialIntegrity(reqNotTargeted, res, next);
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('returns 500 when database validation throws', async () => {
            db.prepare.mockImplementation(() => {
                throw new Error('db is down');
            });

            const req = createRequest({ body: { productId: 1 } });
            const res = createResponse();

            await validateReferentialIntegrity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Database validation failed' });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });
    });

    describe('validateDataConsistency', () => {
        it('returns 409 when duplicate inventory item exists', () => {
            db.prepare.mockReturnValueOnce({
                get: jest.fn().mockReturnValue({ id: 123 }),
            });

            const req = createRequest({
                body: { productId: 1, expiryDate: '2028-05-01', locationId: 4 },
            });
            const res = createResponse();

            validateDataConsistency(req, res, next);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'An inventory item with the same product, expiry date, and location already exists',
            });
            expect(next).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('calls next when duplicate inventory item is not found', () => {
            db.prepare.mockReturnValueOnce({
                get: jest.fn().mockReturnValue(undefined),
            });

            const req = createRequest({
                body: { productId: 1, expiryDate: '2028-05-01', locationId: 4 },
            });
            const res = createResponse();

            validateDataConsistency(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('returns 500 and still calls next when consistency query throws', () => {
            db.prepare.mockImplementation(() => {
                throw new Error('query failed');
            });

            const req = createRequest({
                body: { productId: 1, expiryDate: '2028-05-01', locationId: 4 },
            });
            const res = createResponse();

            validateDataConsistency(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Data consistency check failed' });
            expect(next).toHaveBeenCalledTimes(1);
            expect(mockReleaseDb).toHaveBeenCalledWith(db);
        });

        it('skips DB checks when required fields are missing', () => {
            const req = createRequest({
                body: { productId: 1, expiryDate: undefined, locationId: 4 },
            });
            const res = createResponse();

            validateDataConsistency(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(db.prepare).not.toHaveBeenCalled();
            expect(mockReleaseDb).not.toHaveBeenCalled();
        });
    });

    describe('validateBusinessRules', () => {
        it('returns 400 when expiry date is more than five years in the future', () => {
            const farFuture = new Date();
            farFuture.setFullYear(farFuture.getFullYear() + 6);

            const req = createRequest({
                body: { expiryDate: farFuture.toISOString().split('T')[0] },
            });
            const res = createResponse();

            validateBusinessRules(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Expiry date cannot be more than 5 years in the future',
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 400 when product cost price is negative', () => {
            const req = createRequest({
                path: '/products',
                method: 'PUT',
                body: { cost_price: '-1.25' },
            });
            const res = createResponse();

            validateBusinessRules(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Product cost price cannot be negative' });
            expect(next).not.toHaveBeenCalled();
        });

        it('calls next for valid inventory and product payloads', () => {
            const validExpiry = new Date();
            validExpiry.setFullYear(validExpiry.getFullYear() + 2);

            const inventoryReq = createRequest({
                body: { expiryDate: validExpiry.toISOString().split('T')[0] },
            });
            const inventoryRes = createResponse();

            validateBusinessRules(inventoryReq, inventoryRes, next);
            expect(next).toHaveBeenCalledTimes(1);

            next.mockClear();
            const productReq = createRequest({
                path: '/products',
                method: 'POST',
                body: { cost_price: '0.00' },
            });
            const productRes = createResponse();

            validateBusinessRules(productReq, productRes, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(productRes.status).not.toHaveBeenCalled();
        });

        it('calls next for unrelated paths and methods', () => {
            const req = createRequest({
                path: '/health',
                method: 'GET',
                body: { expiryDate: '3000-01-01', cost_price: '-10' },
            });
            const res = createResponse();

            validateBusinessRules(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});
