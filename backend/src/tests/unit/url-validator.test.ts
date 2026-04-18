import { envConfig } from '../../config/environment';
import { validateRedirectUrl, validateStripePriceId } from '../../utils/url-validator';

describe('validateRedirectUrl', () => {
  const originalFrontendUrl = envConfig.FRONTEND_URL;
  const originalCorsOrigin = envConfig.CORS_ORIGIN;
  const originalNodeEnv = envConfig.NODE_ENV;

  beforeEach(() => {
    envConfig.FRONTEND_URL = 'https://app.example.com';
    envConfig.CORS_ORIGIN = 'https://api.example.com';
    envConfig.NODE_ENV = 'test';
  });

  afterAll(() => {
    envConfig.FRONTEND_URL = originalFrontendUrl;
    envConfig.CORS_ORIGIN = originalCorsOrigin;
    envConfig.NODE_ENV = originalNodeEnv;
  });

  it('allows relative urls', () => {
    expect(() => validateRedirectUrl('/dashboard?tab=imports')).not.toThrow();
  });

  it('rejects empty values', () => {
    expect(() => validateRedirectUrl('')).toThrow('URL must be a non-empty string');
  });

  it('rejects malformed absolute urls', () => {
    expect(() => validateRedirectUrl('http://')).toThrow('URL is not a valid URL: http://');
  });

  it('rejects non-http protocols', () => {
    expect(() => validateRedirectUrl('javascript:alert(1)')).toThrow(
      'URL must use http or https protocol',
    );
  });

  it('allows domains from FRONTEND_URL and CORS_ORIGIN', () => {
    expect(() => validateRedirectUrl('https://app.example.com/welcome')).not.toThrow();
    expect(() => validateRedirectUrl('https://api.example.com/callback')).not.toThrow();
  });

  it('allows localhost variants in test environment', () => {
    expect(() => validateRedirectUrl('http://localhost:3000/path')).not.toThrow();
    expect(() => validateRedirectUrl('http://127.0.0.1:8787/path')).not.toThrow();
    expect(() => validateRedirectUrl('http://[::1]:3000/path')).not.toThrow();
  });

  it('rejects domains outside the allow-list', () => {
    expect(() => validateRedirectUrl('https://evil.example.net/steal')).toThrow(
      'URL domain "evil.example.net" is not allowed',
    );
  });
});

describe('validateStripePriceId', () => {
  it('accepts valid Stripe price ids', () => {
    expect(() => validateStripePriceId('price_1234567890abc')).not.toThrow();
  });

  it('rejects empty ids', () => {
    expect(() => validateStripePriceId('')).toThrow('priceId must be a non-empty string');
  });

  it('rejects ids without the expected prefix', () => {
    expect(() => validateStripePriceId('prod_1234567890')).toThrow(
      'priceId must be a valid Stripe price ID (starts with "price_")',
    );
  });

  it('rejects ids that are too short', () => {
    expect(() => validateStripePriceId('price_123')).toThrow('priceId has invalid length');
  });

  it('rejects ids that are too long', () => {
    const tooLong = `price_${'a'.repeat(200)}`;
    expect(() => validateStripePriceId(tooLong)).toThrow('priceId has invalid length');
  });
});
