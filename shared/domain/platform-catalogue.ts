export interface CatalogueSeedRunDto {
  id: number;
  version: number;
  seededAt: string;
  sourceFileName: string;
  inserted: number;
  updated: number;
  unchanged: number;
  retired: number;
  reinstated: number;
  errorCount: number;
}

export interface CatalogueProvenanceResponse {
  latest: CatalogueSeedRunDto | null;
  history: CatalogueSeedRunDto[];
}

export interface CatalogueSeedRunRecord {
  id: number | string;
  version: number | string;
  seededAt: Date | string;
  sourceFileName: string;
  inserted: number | string;
  updated: number | string;
  unchanged: number | string;
  retired: number | string;
  reinstated: number | string;
  errorCount: number | string;
}

export function isPlatformAdminUser(
  userId: number | undefined,
  configuration: string | undefined,
): boolean {
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0 || !configuration)
    return false;
  const tokens = configuration.split(',').map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => !/^[1-9]\d*$/.test(token))) return false;
  return tokens.map(Number).includes(userId);
}

export function toCatalogueSeedRunDto(record: CatalogueSeedRunRecord): CatalogueSeedRunDto {
  return {
    id: Number(record.id),
    version: Number(record.version),
    seededAt:
      record.seededAt instanceof Date
        ? record.seededAt.toISOString()
        : new Date(record.seededAt).toISOString(),
    sourceFileName: record.sourceFileName,
    inserted: Number(record.inserted),
    updated: Number(record.updated),
    unchanged: Number(record.unchanged),
    retired: Number(record.retired),
    reinstated: Number(record.reinstated),
    errorCount: Number(record.errorCount),
  };
}

export function buildCatalogueProvenanceResponse(
  records: CatalogueSeedRunRecord[],
): CatalogueProvenanceResponse {
  const runs = records.slice(0, 21).map(toCatalogueSeedRunDto);
  return { latest: runs[0] ?? null, history: runs.slice(1) };
}
