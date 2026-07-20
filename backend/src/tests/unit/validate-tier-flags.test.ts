import {
  validateTierFeatureFlags,
  quickValidateTierFeatureFlags,
  seedMissingTierFeatureFlags,
  REQUIRED_FEATURES,
  REQUIRED_TIERS,
  EXPECTED_LIMITS,
} from '../../utils/validate-tier-flags';
import { PrismaClient } from '@prisma/client';

// Mock the logger to avoid noise in tests
vi.mock('../../utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validate-tier-flags', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = new PrismaClient();
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.tierFeatureFlag.deleteMany({});
    await prisma.$disconnect();
  });

  describe('validateTierFeatureFlags', () => {
    it('should return valid=true when all required flags exist', async () => {
      // Seed all required feature flags
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          const limitValue = EXPECTED_LIMITS[tier]?.[feature];
          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await validateTierFeatureFlags(prisma);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.missingFeatures).toHaveLength(0);
    });

    it('should return valid=false when flags are missing', async () => {
      // Only seed partial flags
      await prisma.tierFeatureFlag.create({
        data: {
          tierLevel: 'starter',
          featureKey: 'max_skus',
          enabled: true,
          limitValue: 500,
        },
      });

      const result = await validateTierFeatureFlags(prisma);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.missingFeatures.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Missing feature flag'))).toBe(true);
    });

    it('should detect missing max_inventory_items flag', async () => {
      // Seed all flags EXCEPT max_inventory_items
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          if (feature === 'max_inventory_items') continue;

          const limitValue = EXPECTED_LIMITS[tier]?.[feature];
          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await validateTierFeatureFlags(prisma);

      expect(result.valid).toBe(false);
      expect(result.missingFeatures.some((f) => f.includes('max_inventory_items'))).toBe(true);
    });

    it('should return warnings for incorrect limit values', async () => {
      // Seed all flags but with incorrect limit for starter.max_skus
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          let limitValue = EXPECTED_LIMITS[tier]?.[feature];

          // Intentionally wrong limit for starter.max_skus
          if (tier === 'starter' && feature === 'max_skus') {
            limitValue = 999; // Wrong - should be 500
          }

          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await validateTierFeatureFlags(prisma);

      expect(result.valid).toBe(true); // Still valid, just warnings
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('starter.max_skus'))).toBe(true);
    });

    it('should report correct flag counts per tier', async () => {
      // Seed all flags
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          const limitValue = EXPECTED_LIMITS[tier]?.[feature];
          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await validateTierFeatureFlags(prisma);

      expect(result.flagCounts['starter']).toBe(REQUIRED_FEATURES.length);
      expect(result.flagCounts['professional']).toBe(REQUIRED_FEATURES.length);
      expect(result.flagCounts['premium']).toBe(REQUIRED_FEATURES.length);
      expect(result.flagCounts['concierge']).toBe(REQUIRED_FEATURES.length);
    });
  });

  describe('quickValidateTierFeatureFlags', () => {
    it('should return true when all required flags exist', async () => {
      // Seed all required flags (quick validation checks total count)
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          const limitValue = EXPECTED_LIMITS[tier]?.[feature];
          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await quickValidateTierFeatureFlags(prisma);

      expect(result).toBe(true);
    });

    it('should return false when flags are missing', async () => {
      // Don't seed any flags
      const result = await quickValidateTierFeatureFlags(prisma);

      expect(result).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      // Force an error by disconnecting prisma
      await prisma.$disconnect();

      const result = await quickValidateTierFeatureFlags(prisma);

      expect(result).toBe(false);
    });
  });

  describe('seedMissingTierFeatureFlags', () => {
    it('should seed missing flags', async () => {
      // Seed only one flag
      await prisma.tierFeatureFlag.create({
        data: {
          tierLevel: 'starter',
          featureKey: 'max_skus',
          enabled: true,
          limitValue: 500,
        },
      });

      const result = await seedMissingTierFeatureFlags(prisma);

      expect(result.seeded.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify all flags now exist
      const validation = await validateTierFeatureFlags(prisma);
      expect(validation.valid).toBe(true);
    });

    it('should not re-seed existing flags', async () => {
      // Seed all flags first
      for (const tier of REQUIRED_TIERS) {
        for (const feature of REQUIRED_FEATURES) {
          const limitValue = EXPECTED_LIMITS[tier]?.[feature];
          const enabled = feature.startsWith('max_') || tier !== 'starter';

          await prisma.tierFeatureFlag.create({
            data: {
              tierLevel: tier,
              featureKey: feature,
              enabled,
              limitValue: limitValue ?? null,
            },
          });
        }
      }

      const result = await seedMissingTierFeatureFlags(prisma);

      expect(result.seeded).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should correctly seed max_inventory_items for all tiers', async () => {
      // Clear all flags
      await prisma.tierFeatureFlag.deleteMany({});

      await seedMissingTierFeatureFlags(prisma);

      // Verify max_inventory_items exists for each tier
      for (const tier of REQUIRED_TIERS) {
        const flag = await prisma.tierFeatureFlag.findUnique({
          where: {
            tierLevel_featureKey: {
              tierLevel: tier,
              featureKey: 'max_inventory_items',
            },
          },
        });

        expect(flag).not.toBeNull();
        expect(flag?.limitValue).toBe(EXPECTED_LIMITS[tier].max_inventory_items);
      }
    });

    it('should be idempotent and race-safe when called concurrently', async () => {
      await prisma.tierFeatureFlag.deleteMany({});

      const [firstRun, secondRun] = await Promise.all([
        seedMissingTierFeatureFlags(prisma),
        seedMissingTierFeatureFlags(prisma),
      ]);

      expect(firstRun.errors).toHaveLength(0);
      expect(secondRun.errors).toHaveLength(0);

      const allFlags = await prisma.tierFeatureFlag.findMany();
      expect(allFlags).toHaveLength(REQUIRED_TIERS.length * REQUIRED_FEATURES.length);

      const validation = await validateTierFeatureFlags(prisma);
      expect(validation.valid).toBe(true);
    });
  });

  describe('EXPECTED_LIMITS', () => {
    it('should have correct inventory item limits per tier', () => {
      expect(EXPECTED_LIMITS.free.max_inventory_items).toBe(500);
      expect(EXPECTED_LIMITS.starter.max_inventory_items).toBe(5000);
      expect(EXPECTED_LIMITS.professional.max_inventory_items).toBe(50000);
      expect(EXPECTED_LIMITS.enterprise.max_inventory_items).toBe(250000);
      // Legacy tiers normalized to professional/enterprise equivalents
      expect(EXPECTED_LIMITS.premium.max_inventory_items).toBe(50000);
      expect(EXPECTED_LIMITS.concierge.max_inventory_items).toBe(250000);
    });

    it('should have correct SKU limits per tier', () => {
      expect(EXPECTED_LIMITS.free.max_skus).toBe(500);
      expect(EXPECTED_LIMITS.starter.max_skus).toBe(5000);
      expect(EXPECTED_LIMITS.professional.max_skus).toBe(50000);
      expect(EXPECTED_LIMITS.enterprise.max_skus).toBe(250000);
      // Legacy tiers normalized to professional/enterprise equivalents
      expect(EXPECTED_LIMITS.premium.max_skus).toBe(50000);
      expect(EXPECTED_LIMITS.concierge.max_skus).toBe(250000);
    });

    it('should have correct user limits per tier', () => {
      expect(EXPECTED_LIMITS.free.max_users).toBe(1);
      expect(EXPECTED_LIMITS.starter.max_users).toBe(3);
      expect(EXPECTED_LIMITS.professional.max_users).toBe(10);
      expect(EXPECTED_LIMITS.enterprise.max_users).toBe(10);
      expect(EXPECTED_LIMITS.premium.max_users).toBe(10);
      expect(EXPECTED_LIMITS.concierge.max_users).toBe(10);
    });
  });

  describe('REQUIRED_FEATURES', () => {
    it('should include all critical features', () => {
      expect(REQUIRED_FEATURES).toContain('max_skus');
      expect(REQUIRED_FEATURES).toContain('max_users');
      expect(REQUIRED_FEATURES).toContain('max_inventory_items');
      expect(REQUIRED_FEATURES).toContain('advanced_analytics');
    });
  });

  describe('REQUIRED_TIERS', () => {
    it('should include all tier levels', () => {
      expect(REQUIRED_TIERS).toContain('starter');
      expect(REQUIRED_TIERS).toContain('professional');
      expect(REQUIRED_TIERS).toContain('premium');
      expect(REQUIRED_TIERS).toContain('concierge');
    });
  });
});
