import { MarkdownConfigService } from '../../services/markdown-config.service';
import { MarkdownConfigRepository } from '../../repositories/markdown-config.repository';
import { ValidationError } from '../../errors';
import {
  DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
  DEFAULT_MARKDOWN_MATRIX,
  DEFAULT_MARKDOWN_MATRIX_SET,
  type MarkdownMatrixConfig,
} from '../../../../shared/domain/markdown';

type Record = {
  organizationId: string;
  creditScope: string;
  band1Percentage: number;
  band2Percentage: number;
  band3Percentage: number;
  band1Basis: string;
  band2Basis: string;
  band3Basis: string;
};

function makeService(overrides: { records?: Record[]; hasRetailData?: boolean }) {
  const upsert = vi.fn(
    async (organizationId: string, creditScope: string, data): Promise<Record> => ({
      organizationId,
      creditScope,
      ...data,
    }),
  );
  const repo = {
    findAllByOrganizationId: vi.fn(async () => overrides.records ?? []),
    hasRetailData: vi.fn(async () => overrides.hasRetailData ?? false),
    upsert,
  } as unknown as MarkdownConfigRepository;

  const transaction = vi.fn(async (callback) => callback({ transaction: true }));
  const service = new MarkdownConfigService('org-1', { $transaction: transaction } as never, repo);
  return { service, repo, upsert, transaction };
}

describe('MarkdownConfigService', () => {
  it('returns the default matrix when the org has no stored config', async () => {
    const { service } = makeService({});
    await expect(service.getMatrix()).resolves.toEqual(DEFAULT_MARKDOWN_MATRIX);
  });

  it('defaults each missing scope independently', async () => {
    const noCredit = makeRecord('NO_CREDIT', 40);
    const { service } = makeService({ records: [noCredit] });

    await expect(service.getMatrices()).resolves.toEqual({
      NO_CREDIT: recordMatrix(noCredit),
      FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
    });
  });

  it('maps a stored record to a resolver-ready matrix', async () => {
    const { service } = makeService({
      records: [
        {
          organizationId: 'org-1',
          creditScope: 'NO_CREDIT',
          band1Percentage: 40,
          band2Percentage: 55,
          band3Percentage: 80,
          band1Basis: 'retail',
          band2Basis: 'cost',
          band3Basis: 'retail',
        },
      ],
      hasRetailData: true,
    });

    await expect(service.getMatrix()).resolves.toEqual<MarkdownMatrixConfig>({
      band1: { percentage: 40, basis: 'retail' },
      band2: { percentage: 55, basis: 'cost' },
      band3: { percentage: 80, basis: 'retail' },
    });
  });

  it('getConfig reports whether retail data is available', async () => {
    const { service } = makeService({ hasRetailData: false });
    const config = await service.getConfig();
    expect(config.matrices).toEqual(DEFAULT_MARKDOWN_MATRIX_SET);
    expect(config.matrix).toEqual(DEFAULT_MARKDOWN_MATRIX);
    expect(config.hasRetailData).toBe(false);
  });

  it('rejects a retail-basis band when the org has no retail data', async () => {
    const { service, upsert } = makeService({ hasRetailData: false });
    const matrix: MarkdownMatrixConfig = {
      band1: { percentage: 50, basis: 'retail' },
      band2: { percentage: 60, basis: 'cost' },
      band3: { percentage: 75, basis: 'cost' },
    };
    await expect(service.updateConfig(matrix)).rejects.toBeInstanceOf(ValidationError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persists a valid retail matrix when retail data exists', async () => {
    const { service, upsert } = makeService({ hasRetailData: true });
    const matrix: MarkdownMatrixConfig = {
      band1: { percentage: 50, basis: 'retail' },
      band2: { percentage: 75, basis: 'retail' },
      band3: { percentage: 90, basis: 'retail' },
    };
    const result = await service.updateConfig(matrix);
    expect(upsert).toHaveBeenCalledOnce();
    expect(result.matrix).toEqual(matrix);
    expect(result.hasRetailData).toBe(true);
  });

  it('writes both scoped matrices in one transaction', async () => {
    const { service, upsert, transaction } = makeService({ hasRetailData: true });
    const matrices = {
      NO_CREDIT: makeMatrix(10, 'cost'),
      FULL_CREDIT: makeMatrix(20, 'retail'),
    } as const;

    const result = await service.updateConfig({ matrices });

    expect(transaction).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, 'org-1', 'NO_CREDIT', expect.any(Object), {
      transaction: true,
    });
    expect(upsert).toHaveBeenNthCalledWith(2, 'org-1', 'FULL_CREDIT', expect.any(Object), {
      transaction: true,
    });
    expect(result).toEqual({ matrices, matrix: matrices.NO_CREDIT, hasRetailData: true });
  });

  it('legacy writes update NO_CREDIT only and preserve FULL_CREDIT', async () => {
    const { service, upsert, transaction } = makeService({ hasRetailData: false });
    const matrix = makeMatrix(15, 'cost');

    const result = await service.updateConfig(matrix);

    expect(transaction).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith('org-1', 'NO_CREDIT', expect.any(Object));
    expect(result.matrices.FULL_CREDIT).toEqual(DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX);
  });

  it('persists a cost-only matrix even without retail data', async () => {
    const { service, upsert } = makeService({ hasRetailData: false });
    const matrix: MarkdownMatrixConfig = {
      band1: { percentage: 10, basis: 'cost' },
      band2: { percentage: 20, basis: 'cost' },
      band3: { percentage: 30, basis: 'cost' },
    };
    await service.updateConfig(matrix);
    expect(upsert).toHaveBeenCalledOnce();
  });
});

function makeMatrix(percentage: number, basis: 'cost' | 'retail'): MarkdownMatrixConfig {
  return {
    band1: { percentage, basis },
    band2: { percentage, basis },
    band3: { percentage, basis },
  };
}

function makeRecord(creditScope: string, percentage: number): Record {
  return {
    organizationId: 'org-1',
    creditScope,
    band1Percentage: percentage,
    band2Percentage: percentage,
    band3Percentage: percentage,
    band1Basis: 'cost',
    band2Basis: 'cost',
    band3Basis: 'cost',
  };
}

function recordMatrix(record: Record): MarkdownMatrixConfig {
  return makeMatrix(record.band1Percentage, 'cost');
}
