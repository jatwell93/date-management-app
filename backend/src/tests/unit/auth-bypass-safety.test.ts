import { InventoryService } from '../../services/inventory.service';
import { getOrganizationId, isTestEnvironment } from '../../utils/auth-bypass';

describe('Auth Bypass Safety', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;

  afterEach(() => {
    // Restore original environment variables
    process.env.NODE_ENV = originalNodeEnv;
    process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
  });

  describe('isTestEnvironment', () => {
    it('should return true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_AUTH_BYPASS;
      expect(isTestEnvironment()).toBe(true);
    });

    it('should return true when TEST_AUTH_BYPASS is true', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(isTestEnvironment()).toBe(true);
    });

    it('should return false in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(isTestEnvironment()).toBe(false);
    });
  });

  describe('getOrganizationId', () => {
    it('should return provided organizationId', () => {
      const result = getOrganizationId('org-123');
      expect(result).toBe('org-123');
    });

    it('should return test bypass ID in test environment', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_AUTH_BYPASS;
      const result = getOrganizationId();
      expect(result).toBe('default-org');
    });

    it('should throw error in production without organizationId', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(() => getOrganizationId()).toThrow('Organization ID is required in production environments');
    });
  });

  describe('InventoryService Safety', () => {
    it('should work with explicit organizationId', () => {
      const service = new InventoryService('org-123');
      expect(service).toBeDefined();
    });

    it('should work in test environment without organizationId', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_AUTH_BYPASS;
      const service = new InventoryService();
      expect(service).toBeDefined();
    });

    it('should throw error in production without organizationId', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(() => new InventoryService()).toThrow('Organization ID is required in production environments');
    });
  });
});
