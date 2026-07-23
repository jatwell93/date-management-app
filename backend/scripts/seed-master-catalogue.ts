import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import {
  CatalogueSeedValidationError,
  RetirementThresholdExceeded,
  SeedService,
} from '../src/services/seed.service';

export interface SeedMasterCatalogueArgs {
  workbookPath: string;
  dryRun: boolean;
  confirmRetirements: boolean;
}

export function parseSeedMasterCatalogueArgs(args: string[]): SeedMasterCatalogueArgs {
  const paths: string[] = [];
  let dryRun = false;
  let confirmRetirements = false;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--confirm-retirements') confirmRetirements = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else paths.push(arg);
  }

  if (paths.length === 0) throw new Error('A master catalogue workbook path is required');
  if (paths.length !== 1) throw new Error('Provide exactly one workbook path');

  return { workbookPath: paths[0], dryRun, confirmRetirements };
}

export function assertSafeSeedInvocation(
  args: SeedMasterCatalogueArgs,
  nodeEnv = process.env.NODE_ENV,
): void {
  const sampleWorkbook = path.resolve(
    __dirname,
    '../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
  );
  if (
    nodeEnv === 'production' &&
    !args.dryRun &&
    path.resolve(args.workbookPath) === sampleWorkbook
  ) {
    throw new Error('Refusing to live-seed the production catalogue from the sample workbook');
  }
}

export function serializeSeedMasterCatalogueError(error: unknown): Record<string, unknown> {
  if (error instanceof CatalogueSeedValidationError) {
    return {
      name: error.name,
      message: error.message,
      result: error.result,
    };
  }
  if (error instanceof RetirementThresholdExceeded) {
    return {
      name: error.name,
      message: error.message,
      retired: error.retired,
      activeBefore: error.activeBefore,
      proportion: error.proportion,
      threshold: error.threshold,
    };
  }
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function main(): Promise<void> {
  const args = parseSeedMasterCatalogueArgs(process.argv.slice(2));
  assertSafeSeedInvocation(args);
  const prisma = new PrismaClient();
  try {
    const result = await new SeedService(prisma).seedMasterCatalogue(args.workbookPath, {
      dryRun: args.dryRun,
      confirmRetirements: args.confirmRetirements,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify(serializeSeedMasterCatalogueError(error), null, 2)}\n`);
    process.exitCode = 1;
  });
}
