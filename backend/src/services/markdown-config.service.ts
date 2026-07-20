import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { ValidationError } from '../errors';
import {
  MarkdownConfigRepository,
  type MarkdownConfigWriteData,
} from '../repositories/markdown-config.repository';
import {
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownBasis,
  type MarkdownMatrixConfig,
} from '../../../shared/domain/markdown';
import type { MarkdownConfig, MarkdownConfigResponse } from '../models/markdown-config.model';

type MarkdownConfigRecord = {
  organizationId: string;
  band1Percentage: number;
  band2Percentage: number;
  band3Percentage: number;
  band1Basis: string;
  band2Basis: string;
  band3Basis: string;
};

function toBasis(value: string): MarkdownBasis {
  return value === 'retail' ? 'retail' : 'cost';
}

function recordToMatrix(record: MarkdownConfigRecord): MarkdownMatrixConfig {
  return {
    band1: { percentage: record.band1Percentage, basis: toBasis(record.band1Basis) },
    band2: { percentage: record.band2Percentage, basis: toBasis(record.band2Basis) },
    band3: { percentage: record.band3Percentage, basis: toBasis(record.band3Basis) },
  };
}

function matrixToWriteData(matrix: MarkdownMatrixConfig): MarkdownConfigWriteData {
  return {
    band1Percentage: matrix.band1.percentage,
    band2Percentage: matrix.band2.percentage,
    band3Percentage: matrix.band3.percentage,
    band1Basis: matrix.band1.basis,
    band2Basis: matrix.band2.basis,
    band3Basis: matrix.band3.basis,
  };
}

export class MarkdownConfigService {
  private prisma: PrismaClient;
  private repo: MarkdownConfigRepository;
  private organizationId: string;

  constructor(
    organizationId?: string,
    prismaClient?: PrismaClient,
    repo?: MarkdownConfigRepository,
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.repo = repo ?? new MarkdownConfigRepository(this.prisma);
  }

  /**
   * The organization's matrix for internal price resolution. Falls back to the
   * default 50/60/75%-off-cost ladder when the org has not customized it.
   */
  async getMatrix(): Promise<MarkdownMatrixConfig> {
    const record = await this.repo.findByOrganizationId(this.organizationId);
    return record ? recordToMatrix(record) : DEFAULT_MARKDOWN_MATRIX;
  }

  /** The API/UI-facing config: the matrix plus whether retail basis is available. */
  async getConfig(): Promise<MarkdownConfigResponse> {
    const [matrix, hasRetailData] = await Promise.all([
      this.getMatrix(),
      this.repo.hasRetailData(this.organizationId),
    ]);
    return { matrix, hasRetailData };
  }

  /**
   * Persist a new matrix. Zod has already bounded percentages, validated the basis
   * enum, and enforced non-decreasing discounts; here we enforce the one rule that
   * needs the database: a retail-basis band requires the org to have retail data.
   */
  async updateConfig(matrix: MarkdownMatrixConfig): Promise<MarkdownConfigResponse> {
    const wantsRetail =
      matrix.band1.basis === 'retail' ||
      matrix.band2.basis === 'retail' ||
      matrix.band3.basis === 'retail';

    const hasRetailData = await this.repo.hasRetailData(this.organizationId);

    if (wantsRetail && !hasRetailData) {
      throw new ValidationError(
        'Retail-based markdowns require retail prices. Upload a catalogue with a retail (or selling price) column first.',
      );
    }

    const record = await this.repo.upsert(this.organizationId, matrixToWriteData(matrix));
    return { matrix: recordToMatrix(record), hasRetailData };
  }
}

export type { MarkdownConfig };
