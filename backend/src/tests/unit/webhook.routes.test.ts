import express from 'express';
import request from 'supertest';
import webhookRouter from '../../routes/webhook.routes';
import { ConflictError, NotFoundError } from '../../errors';
import { WebhookController } from '../../controllers/webhook.controller';

const mockRecordWebhookEvent = vi.fn();

const webhookService = {
  verifySignature: vi.fn(),
  isNewEvent: vi.fn(),
  handleEvent: vi.fn(),
  markEventProcessed: vi.fn(),
};

const clerkWebhookService = {
  verifySignature: vi.fn(),
  isNewEvent: vi.fn(),
  handleEvent: vi.fn(),
  markEventProcessed: vi.fn(),
};

vi.mock('../../di/services', () => ({
  createWebhookController: vi.fn(),
}));

vi.mock('../../services/application.monitoring.service', () => ({
  ApplicationMonitoringService: {
    getInstance: vi.fn().mockReturnValue({
      recordWebhookEvent: (...args: unknown[]) => mockRecordWebhookEvent(...args),
    }),
  },
}));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { createWebhookController } = (await vi.importMock('../../di/services')) as {
  createWebhookController: jest.Mock;
};

describe('webhook.routes Stripe error handling', () => {
  const app = express();
  app.use('/webhooks', express.raw({ type: '*/*' }), webhookRouter);

  beforeEach(() => {
    vi.clearAllMocks();

    createWebhookController.mockReturnValue(
      new WebhookController(webhookService as any, clerkWebhookService as any),
    );

    webhookService.verifySignature.mockReturnValue({
      id: 'evt_test_1',
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    webhookService.isNewEvent.mockResolvedValue(true);
    webhookService.handleEvent.mockResolvedValue(undefined);
    webhookService.markEventProcessed.mockResolvedValue(undefined);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_missing_sig' })));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing stripe-signature header' });
    expect(webhookService.verifySignature).not.toHaveBeenCalled();
  });

  it('returns 400 when stripe signature verification fails', async () => {
    webhookService.verifySignature.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_invalid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_bad_sig' })));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid signature' });
  });

  it('returns 200 without processing when Stripe event is duplicate', async () => {
    webhookService.isNewEvent.mockResolvedValue(false);

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_duplicate')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_dup' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(webhookService.handleEvent).not.toHaveBeenCalled();
    expect(mockRecordWebhookEvent).toHaveBeenCalledWith(
      'customer.subscription.updated',
      0,
      'skipped',
    );
  });

  it('returns 200 when Stripe event is processed successfully', async () => {
    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_success')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_success' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(webhookService.handleEvent).toHaveBeenCalled();
    expect(webhookService.markEventProcessed).toHaveBeenCalledWith(
      'evt_test_1',
      'customer.subscription.updated',
    );
    expect(mockRecordWebhookEvent).toHaveBeenCalledWith(
      'customer.subscription.updated',
      expect.any(Number),
      'success',
    );
  });

  it('returns 200 for non-recoverable mapping errors to avoid Stripe retry storms', async () => {
    webhookService.handleEvent.mockRejectedValue(
      new Error('Missing organizationId in Stripe customer metadata'),
    );

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_test_1' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(webhookService.handleEvent).toHaveBeenCalled();
  });

  it('returns 500 for transient processing errors so Stripe retries', async () => {
    webhookService.handleEvent.mockRejectedValue(new Error('database timeout'));

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_test_2' })));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Error processing webhook event' });
    expect(mockRecordWebhookEvent).toHaveBeenCalledWith(
      'customer.subscription.updated',
      expect.any(Number),
      'error',
    );
  });

  it('returns 200 for NotFoundError to stop Stripe retries on non-recoverable issues', async () => {
    webhookService.handleEvent.mockRejectedValue(new NotFoundError('organization not found'));

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_not_found')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_test_3' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
  });

  it('returns 500 for unexpected Stripe handler failures', async () => {
    webhookService.isNewEvent.mockRejectedValue(new Error('idempotency check failed'));

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_unexpected')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_unexpected' })));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });
});

describe('webhook.routes Clerk error handling', () => {
  const app = express();
  app.use('/webhooks', express.raw({ type: '*/*' }), webhookRouter);

  beforeEach(() => {
    vi.clearAllMocks();

    createWebhookController.mockReturnValue(
      new WebhookController(webhookService as any, clerkWebhookService as any),
    );

    clerkWebhookService.verifySignature.mockReturnValue({
      type: 'user.created',
      data: {},
    });
    clerkWebhookService.isNewEvent.mockResolvedValue(true);
    clerkWebhookService.handleEvent.mockResolvedValue(undefined);
    clerkWebhookService.markEventProcessed.mockResolvedValue(undefined);
  });

  it('returns 400 when required Svix headers are missing', async () => {
    const response = await request(app)
      .post('/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required Svix headers' });
    expect(clerkWebhookService.verifySignature).not.toHaveBeenCalled();
  });

  it('returns 400 when Clerk signature verification fails', async () => {
    clerkWebhookService.verifySignature.mockImplementation(() => {
      throw new Error('invalid svix signature');
    });

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_bad_sig')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,bad')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid svix signature' });
  });

  it('returns 400 when Clerk payload is not an object', async () => {
    clerkWebhookService.verifySignature.mockReturnValue('invalid payload');

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_invalid_payload')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid webhook payload' });
  });

  it('returns 200 without processing when Clerk event is duplicate', async () => {
    clerkWebhookService.isNewEvent.mockResolvedValue(false);

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_duplicate')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(clerkWebhookService.handleEvent).not.toHaveBeenCalled();
    expect(mockRecordWebhookEvent).toHaveBeenCalledWith('user.created', 0, 'skipped');
  });

  it('returns 200 when Clerk event is processed successfully', async () => {
    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_success')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(clerkWebhookService.handleEvent).toHaveBeenCalled();
    expect(clerkWebhookService.markEventProcessed).toHaveBeenCalledWith(
      'msg_success',
      'user.created',
    );
    expect(mockRecordWebhookEvent).toHaveBeenCalledWith(
      'user.created',
      expect.any(Number),
      'success',
    );
  });

  it('returns 409 for duplicate-email conflict errors', async () => {
    clerkWebhookService.handleEvent.mockRejectedValue(
      new ConflictError('Email already registered'),
    );

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_123')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Email already registered' });
  });

  it('returns 500 for transient Clerk processing errors', async () => {
    clerkWebhookService.handleEvent.mockRejectedValue(new Error('database timeout'));

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_456')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Error processing webhook event' });
  });

  it('returns 500 for unexpected Clerk handler failures', async () => {
    clerkWebhookService.isNewEvent.mockRejectedValue(new Error('idempotency failed'));

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_unexpected')
      .set('svix-timestamp', String(Date.now()))
      .set('svix-signature', 'v1,test')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'user.created' })));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });
});
