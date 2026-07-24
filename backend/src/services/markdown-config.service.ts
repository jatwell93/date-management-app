import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { ValidationError } from '../errors';
import {
  MarkdownConfigRepository,
  type MarkdownConfigWriteData,
} from '../repositories/markdown-config.repository';
import {
  DEFAULT_MARKDOWN_MATRIX_SET,
  type CreditScope,
  type MarkdownBasis,
  type MarkdownMatrixConfig,
  type MarkdownMatrixSet,
} from '../../../shared/domain/markdown';
import type { MarkdownConfig, MarkdownConfigResponse } from '../models/markdown-config.model';

type MarkdownConfigRecord = {
  organizationId: string;
  creditScope: string;
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
    return (await this.getMatrices()).NO_CREDIT;
  }

  async getMatrices(): Promise<MarkdownMatrixSet> {
    const records = await this.repo.findAllByOrganizationId(this.organizationId);
    const matrices: MarkdownMatrixSet = {
      NO_CREDIT: DEFAULT_MARKDOWN_MATRIX_SET.NO_CREDIT,
      FULL_CREDIT: DEFAULT_MARKDOWN_MATRIX_SET.FULL_CREDIT,
    };
    for (const record of records) {
      if (record.creditScope === 'NO_CREDIT' || record.creditScope === 'FULL_CREDIT') {
        matrices[record.creditScope] = recordToMatrix(record);
      }
    }
    return matrices;
  }

  /** The API/UI-facing config: the matrix plus whether retail basis is available. */
  async getConfig(): Promise<MarkdownConfigResponse> {
    const [matrices, hasRetailData] = await Promise.all([
      this.getMatrices(),
      this.repo.hasRetailData(this.organizationId),
    ]);
    return { matrices, matrix: matrices.NO_CREDIT, hasRetailData };
  }

  /**
   * Persist a new matrix. Zod has already bounded percentages, validated the basis
   * enum, and enforced non-decreasing discounts; here we enforce the one rule that
   * needs the database: a retail-basis band requires the org to have retail data.
   */
  async updateConfig(
    input: MarkdownMatrixConfig | { matrices: MarkdownMatrixSet },
  ): Promise<MarkdownConfigResponse> {
    const isScopedUpdate = 'matrices' in input;
    const matricesToWrite: Array<[CreditScope, MarkdownMatrixConfig]> = isScopedUpdate
      ? [
          ['NO_CREDIT', input.matrices.NO_CREDIT],
          ['FULL_CREDIT', input.matrices.FULL_CREDIT],
        ]
      : [['NO_CREDIT', input]];
    const wantsRetail = matricesToWrite.some(([, matrix]) =>
      [matrix.band1, matrix.band2, matrix.band3].some((band) => band.basis === 'retail'),
    );

    const [hasRetailData, existingMatrices] = await Promise.all([
      this.repo.hasRetailData(this.organizationId),
      isScopedUpdate ? Promise.resolve(null) : this.getMatrices(),
    ]);

    if (wantsRetail && !hasRetailData) {
      throw new ValidationError(
        'Retail-based markdowns require retail prices. Upload a catalogue with a retail (or selling price) column first.',
      );
    }

    if (isScopedUpdate) {
      await this.prisma.$transaction(async (tx) => {
        for (const [scope, matrix] of matricesToWrite) {
          await this.repo.upsert(this.organizationId, scope, matrixToWriteData(matrix), tx);
        }
      });
      return {
        matrices: input.matrices,
        matrix: input.matrices.NO_CREDIT,
        hasRetailData,
      };
    }

    const record = await this.repo.upsert(
      this.organizationId,
      'NO_CREDIT',
      matrixToWriteData(input),
    );
    const matrices = existingMatrices as MarkdownMatrixSet;
    matrices.NO_CREDIT = recordToMatrix(record);
    return { matrices, matrix: matrices.NO_CREDIT, hasRetailData };
  }
}

export type { MarkdownConfig };
