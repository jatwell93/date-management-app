import { MarkdownConfigService } from '../../services/markdown-config.service';
import { MarkdownConfigRepository } from '../../repositories/markdown-config.repository';
import { ValidationError } from '../../errors';
import {
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownMatrixConfig,
} from '../../../../shared/domain/markdown';

type Record = {
  organizationId: string;
  band1Percentage: number;
  band2Percentage: number;
  band3Percentage: number;
  band1Basis: string;
  band2Basis: string;
  band3Basis: string;
};

function makeService(overrides: { record?: Record | null; hasRetailData?: boolean }) {
  const upsert = vi.fn(
    async (organizationId: string, data): Promise<Record> => ({
      organizationId,
      ...data,
    }),
  );
  const repo = {
    findByOrganizationId: vi.fn(async () => overrides.record ?? null),
    hasRetailData: vi.fn(async () => overrides.hasRetailData ?? false),
    upsert,
  } as unknown as MarkdownConfigRepository;

  // prisma is unused because the fake repo is injected.
  const service = new MarkdownConfigService('org-1', {} as never, repo);
  return { service, repo, upsert };
}

describe('MarkdownConfigService', () => {
  it('returns the default matrix when the org has no stored config', async () => {
    const { service } = makeService({ record: null });
    await expect(service.getMatrix()).resolves.toEqual(DEFAULT_MARKDOWN_MATRIX);
  });

  it('maps a stored record to a resolver-ready matrix', async () => {
    const { service } = makeService({
      record: {
        organizationId: 'org-1',
        band1Percentage: 40,
        band2Percentage: 55,
        band3Percentage: 80,
        band1Basis: 'retail',
        band2Basis: 'cost',
        band3Basis: 'retail',
      },
      hasRetailData: true,
    });

    await expect(service.getMatrix()).resolves.toEqual<MarkdownMatrixConfig>({
      band1: { percentage: 40, basis: 'retail' },
      band2: { percentage: 55, basis: 'cost' },
      band3: { percentage: 80, basis: 'retail' },
    });
  });

  it('getConfig reports whether retail data is available', async () => {
    const { service } = makeService({ record: null, hasRetailData: false });
    const config = await service.getConfig();
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
