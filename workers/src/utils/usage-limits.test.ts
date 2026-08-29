/**
 * Coverage for the Worker's tier limit table (task 3.1.a, issue #471).
 *
 * These assertions are deliberately written against
 * `shared/types/subscription.ts` rather than restating the Worker's own
 * numbers. A test that says `LAUNCH_TIER_LIMITS.free.maxSkus === 500` only
 * proves the file has not been edited; what matters is that the Worker refuses
 * at the same threshold the rest of the product promises, so the assertions
 * below compare the two tables and fail on drift in either.
 *
 * This replaces the tier-limit coverage in the deleted
 * `utils/feature-gates.test.ts`, whose module had no production importer
 * (task 3.1.a). The audit rows that cited it for tier-limit equivalence
 * (2.2 part3, EXPECTED_LIMITS rows) now cite this file.
 */
import { describe, expect, it } from 'vitest';
import { TIER_LIMITS } from '../../../shared/types/subscription';
import type { Env } from '../types/env';
import {
  isUsageEnforcementEnabled,
  UNLIMITED_CAP,
  LAUNCH_TIER_LIMITS,
  LAUNCH_TIER_USER_LIMITS,
  STORAGE_LIMIT_BYTES_BY_TIER,
  normalizeLaunchTier,
  parsePositiveIntEnv,
  resolveMaxActiveExpiries,
  resolveMaxSkus,
  resolveStorageLimitBytes,
} from './usage-limits';

const LAUNCH_TIERS = ['free', 'starter', 'professional', 'enterprise'] as const;
const emptyEnv = {} as Env;

describe('tier limit table agrees with the shared source of truth', () => {
  it.each(LAUNCH_TIERS)('matches shared max_skus for %s', (tier) => {
    expect(LAUNCH_TIER_LIMITS[tier].maxSkus).toBe(TIER_LIMITS[tier].max_skus);
  });

  it.each(LAUNCH_TIERS)('matches shared max_inventory_items for %s', (tier) => {
    expect(LAUNCH_TIER_LIMITS[tier].maxActiveExpiries).toBe(TIER_LIMITS[tier].max_inventory_items);
  });

  it.each(LAUNCH_TIERS)('matches shared max_users for %s', (tier) => {
    expect(LAUNCH_TIER_USER_LIMITS[tier]).toBe(TIER_LIMITS[tier].max_users);
  });

  // Storage is the one column where the Worker deliberately does NOT follow
  // `TIER_LIMITS`. Two of the three sources in the repo say 1/10/1000 GiB
  // (this table and backend StorageQuotaService's SUBSCRIPTION_TIERS) and
  // `TIER_LIMITS.storage_bytes` says 100GB for professional and enterprise.
  // The divergence is asserted rather than silently tolerated: if someone
  // reconciles the constants, this test fails and points at the decision
  // instead of letting the Worker's enforced limit drift away from the limit
  // it reports on the dashboard.
  it('keeps storage on the 1/10/1000 GiB line, diverging from TIER_LIMITS', () => {
    const GIB = 1024 * 1024 * 1024;
    expect(STORAGE_LIMIT_BYTES_BY_TIER).toEqual({
      free: 1 * GIB,
      starter: 10 * GIB,
      professional: 10 * GIB,
      enterprise: 1000 * GIB,
    });
    expect(STORAGE_LIMIT_BYTES_BY_TIER.professional).not.toBe(
      TIER_LIMITS.professional.storage_bytes,
    );
  });
});

describe('normalizeLaunchTier', () => {
  it.each(LAUNCH_TIERS)('passes the canonical tier %s through', (tier) => {
    expect(normalizeLaunchTier(tier)).toBe(tier);
  });

  // premium and concierge are legacy tiers retained as a migration bridge;
  // they must land on a real launch tier rather than falling to free, or a
  // paying legacy customer would be capped at the free entitlement.
  it('maps the legacy tier premium to professional', () => {
    expect(normalizeLaunchTier('premium')).toBe('professional');
  });

  it('maps the legacy tier concierge to enterprise', () => {
    expect(normalizeLaunchTier('concierge')).toBe('enterprise');
  });

  it.each([['PROFESSIONAL'], ['  Starter  '], ['Enterprise']])(
    'normalizes case and surrounding whitespace in %j',
    (input) => {
      expect(LAUNCH_TIERS).toContain(normalizeLaunchTier(input));
    },
  );

  it.each([[null], [undefined], [''], ['platinum'], [42]])(
    'defaults the unrecognised tier %j to free',
    (input) => {
      expect(normalizeLaunchTier(input)).toBe('free');
    },
  );
});

describe('parsePositiveIntEnv', () => {
  it('uses a valid positive integer', () => {
    expect(parsePositiveIntEnv('750', 100)).toBe(750);
  });

  it('floors a fractional value rather than admitting a fraction of a SKU', () => {
    expect(parsePositiveIntEnv('750.9', 100)).toBe(750);
  });

  // The guard that matters: without it a misconfigured var yields NaN, and
  // `count < NaN` is always false, so every create would be refused.
  it.each([[undefined], [''], ['abc'], ['0'], ['-5'], ['NaN']])(
    'falls back to the default for the unusable value %j',
    (input) => {
      expect(parsePositiveIntEnv(input, 100)).toBe(100);
    },
  );
});

describe('limit resolution', () => {
  it.each(LAUNCH_TIERS)('resolves the table SKU cap for %s with no override', (tier) => {
    expect(resolveMaxSkus(tier, emptyEnv)).toBe(LAUNCH_TIER_LIMITS[tier].maxSkus);
  });

  it('honours ENTERPRISE_MAX_SKUS for enterprise', () => {
    expect(resolveMaxSkus('enterprise', { ENTERPRISE_MAX_SKUS: '900000' } as Env)).toBe(900000);
  });

  // The override is enterprise-only: a contract negotiated for one customer
  // must not silently raise every other tenant's cap.
  it.each(['free', 'starter', 'professional'] as const)(
    'ignores ENTERPRISE_MAX_SKUS for the non-enterprise tier %s',
    (tier) => {
      expect(resolveMaxSkus(tier, { ENTERPRISE_MAX_SKUS: '900000' } as Env)).toBe(
        LAUNCH_TIER_LIMITS[tier].maxSkus,
      );
    },
  );

  it('honours ENTERPRISE_MAX_ACTIVE_EXPIRIES for enterprise', () => {
    expect(
      resolveMaxActiveExpiries('enterprise', { ENTERPRISE_MAX_ACTIVE_EXPIRIES: '800000' } as Env),
    ).toBe(800000);
  });

  it('falls back to the table when the enterprise override is unusable', () => {
    expect(resolveMaxSkus('enterprise', { ENTERPRISE_MAX_SKUS: 'lots' } as Env)).toBe(
      LAUNCH_TIER_LIMITS.enterprise.maxSkus,
    );
  });

  it.each(LAUNCH_TIERS)('resolves the storage cap for %s', (tier) => {
    expect(resolveStorageLimitBytes(tier)).toBe(STORAGE_LIMIT_BYTES_BY_TIER[tier]);
  });
});

describe('isUsageEnforcementEnabled', () => {
  // The default matters more than the parse. An unset flag is the deployed
  // state until the usage trial replaces the estimated tier limits, so this is
  // the assertion that would catch someone "tidying" the check into a truthy
  // test and silently arming every cap in production.
  it('is off when the flag is unset', () => {
    expect(isUsageEnforcementEnabled({} as Env)).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    expect(isUsageEnforcementEnabled({ USAGE_LIMITS_ENFORCE: 'true' } as Env)).toBe(true);
  });

  // Wrangler vars are strings, so a boolean `true` in wrangler.toml arrives as
  // "true", but "1"/"yes"/"TRUE" are plausible hand-edits. A guard on customer
  // writes should stay disarmed for all of them rather than half-arm.
  it.each(['1', 'yes', 'TRUE', 'True', 'on', '', ' true '])(
    'stays off for the near-miss value %o',
    (value) => {
      expect(isUsageEnforcementEnabled({ USAGE_LIMITS_ENFORCE: value } as Env)).toBe(false);
    },
  );
});

describe('UNLIMITED_CAP', () => {
  // It is compared against COUNT(*) inside the INSERT, so it has to survive the
  // trip through the driver as an exact integer and sit inside bigint.
  it('is an exact integer no real tier limit can reach', () => {
    expect(Number.isSafeInteger(UNLIMITED_CAP)).toBe(true);
    expect(UNLIMITED_CAP).toBeLessThan(2 ** 63 - 1);
    for (const tier of LAUNCH_TIERS) {
      expect(LAUNCH_TIER_LIMITS[tier].maxSkus).toBeLessThan(UNLIMITED_CAP);
      expect(LAUNCH_TIER_LIMITS[tier].maxActiveExpiries).toBeLessThan(UNLIMITED_CAP);
    }
  });
});
