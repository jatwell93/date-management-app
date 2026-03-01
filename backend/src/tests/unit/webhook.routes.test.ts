import express from 'express';
import request from 'supertest';
import webhookRouter from '../../routes/webhook.routes';
import { ConflictError } from '../../errors';

jest.mock('../../services/webhook.service', () => ({
  webhookService: {
    verifySignature: jest.fn(),
    isNewEvent: jest.fn(),
    handleEvent: jest.fn(),
    markEventProcessed: jest.fn(),
    sendSuccess: jest.fn((res: any) => res.status(200).json({ received: true })),
    sendError: jest.fn((res: any, message: string, statusCode = 400) =>
      res.status(statusCode).json({ error: message }),
    ),
  },
}));

jest.mock('../../services/clerk-webhook.service', () => ({
  clerkWebhookService: {
    verifySignature: jest.fn(),
    isNewEvent: jest.fn(),
    handleEvent: jest.fn(),
    markEventProcessed: jest.fn(),
    sendSuccess: jest.fn((res: any) => res.status(200).json({ received: true })),
    sendError: jest.fn((res: any, message: string, statusCode = 400) =>
      res.status(statusCode).json({ error: message }),
    ),
  },
}));

jest.mock('../../services/application.monitoring.service', () => ({
  ApplicationMonitoringService: {
    getInstance: jest.fn().mockReturnValue({
      recordWebhookEvent: jest.fn(),
    }),
  },
}));

const { webhookService } = jest.requireMock('../../services/webhook.service') as {
  webhookService: {
    verifySignature: jest.Mock;
    isNewEvent: jest.Mock;
    handleEvent: jest.Mock;
    markEventProcessed: jest.Mock;
    sendSuccess: jest.Mock;
    sendError: jest.Mock;
  };
};

const { clerkWebhookService } = jest.requireMock('../../services/clerk-webhook.service') as {
  clerkWebhookService: {
    verifySignature: jest.Mock;
    isNewEvent: jest.Mock;
    handleEvent: jest.Mock;
    markEventProcessed: jest.Mock;
    sendSuccess: jest.Mock;
    sendError: jest.Mock;
  };
};

describe('webhook.routes Stripe error handling', () => {
  const app = express();
  app.use('/webhooks', express.raw({ type: '*/*' }), webhookRouter);

  beforeEach(() => {
    jest.clearAllMocks();

    webhookService.verifySignature.mockReturnValue({
      id: 'evt_test_1',
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    webhookService.isNewEvent.mockResolvedValue(true);
    webhookService.markEventProcessed.mockResolvedValue(undefined);
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
    expect(webhookService.sendSuccess).toHaveBeenCalled();
    expect(webhookService.sendError).not.toHaveBeenCalled();
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
    expect(webhookService.sendError).toHaveBeenCalledWith(
      expect.anything(),
      'Error processing webhook event',
      500,
    );
  });
});

describe('webhook.routes Clerk error handling', () => {
  const app = express();
  app.use('/webhooks', express.raw({ type: '*/*' }), webhookRouter);

  beforeEach(() => {
    jest.clearAllMocks();

    clerkWebhookService.verifySignature.mockReturnValue({
      type: 'user.created',
      data: {},
    });
    clerkWebhookService.isNewEvent.mockResolvedValue(true);
    clerkWebhookService.markEventProcessed.mockResolvedValue(undefined);
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
    expect(clerkWebhookService.sendError).toHaveBeenCalledWith(
      expect.anything(),
      'Email already registered',
      409,
    );
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
});
