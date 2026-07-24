export const POLICY_STATUSES = ['ATTACHED', 'MISSING'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const CREDIT_TYPES = ['NONE', 'FULL_CREDIT'] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export function isCreditType(value: unknown): value is CreditType {
  return typeof value === 'string' && CREDIT_TYPES.includes(value as CreditType);
}

export interface SupplierPolicyRecord {
  creditType?: CreditType | string | null;
  creditPolicyNote?: string | null;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface PolicyFieldError {
  field: 'creditPolicyNote' | 'contact';
  message: string;
}

const POLICY_FIELDS = [
  'creditType',
  'creditPolicyNote',
  'policyWriteOffQty',
  'policyCreditQty',
  'followUpDays',
  'representativeName',
  'representativeEmail',
] as const;

type PolicyField = (typeof POLICY_FIELDS)[number];
type NormalizedPolicy = Record<PolicyField, string | number | null>;

const CREATE_BASELINE: Required<SupplierPolicyRecord> = {
  creditType: 'NONE',
  creditPolicyNote: '',
  policyWriteOffQty: null,
  policyCreditQty: null,
  followUpDays: 7,
  representativeName: null,
  representativeEmail: null,
  contactEmail: null,
  contactPhone: null,
};

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function effectiveNullable<T>(
  value: T | null | undefined,
  fallback: T | null | undefined,
): T | null {
  return value === undefined ? (fallback ?? null) : value;
}

function effectiveText(
  value: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return normalizeText(value === undefined ? fallback : value);
}

function effectiveRecord(
  payload: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
): Required<SupplierPolicyRecord> {
  const base = existing ?? CREATE_BASELINE;
  return {
    creditType: isCreditType(payload.creditType)
      ? payload.creditType
      : isCreditType(base.creditType)
        ? base.creditType
        : 'NONE',
    creditPolicyNote: effectiveText(payload.creditPolicyNote, base.creditPolicyNote) ?? '',
    policyWriteOffQty: effectiveNullable(payload.policyWriteOffQty, base.policyWriteOffQty),
    policyCreditQty: effectiveNullable(payload.policyCreditQty, base.policyCreditQty),
    followUpDays: effectiveNullable(payload.followUpDays, base.followUpDays) ?? 7,
    representativeName: effectiveText(payload.representativeName, base.representativeName),
    representativeEmail: effectiveText(payload.representativeEmail, base.representativeEmail),
    contactEmail: effectiveText(payload.contactEmail, base.contactEmail),
    contactPhone: effectiveText(payload.contactPhone, base.contactPhone),
  };
}

function hasContact(record: Required<SupplierPolicyRecord>): boolean {
  return [record.contactEmail, record.contactPhone, record.representativeEmail].some(
    (value) => normalizeText(value) !== null,
  );
}

function normalizedPolicy(record: SupplierPolicyRecord): NormalizedPolicy {
  const effective = effectiveRecord(record, null);
  return {
    creditType: isCreditType(effective.creditType) ? effective.creditType : 'NONE',
    creditPolicyNote: normalizeText(effective.creditPolicyNote) ?? '',
    policyWriteOffQty: effective.policyWriteOffQty,
    policyCreditQty: effective.policyCreditQty,
    followUpDays: effective.followUpDays,
    representativeName: normalizeText(effective.representativeName),
    representativeEmail: normalizeText(effective.representativeEmail),
  };
}

export function creditScopeForSupplier(
  supplier: Pick<SupplierPolicyRecord, 'creditType'> | null | undefined,
): 'NO_CREDIT' | 'FULL_CREDIT' {
  return supplier?.creditType === 'FULL_CREDIT' ? 'FULL_CREDIT' : 'NO_CREDIT';
}

export function hasPolicy(
  supplier: Pick<SupplierPolicyRecord, 'creditPolicyNote'> | null | undefined,
): boolean {
  return Boolean(supplier?.creditPolicyNote?.trim());
}

export function brandPolicyStatus(
  _brand: unknown,
  resolvedSupplier: Pick<SupplierPolicyRecord, 'creditPolicyNote'> | null | undefined,
): PolicyStatus {
  return hasPolicy(resolvedSupplier) ? 'ATTACHED' : 'MISSING';
}

export function isPolicyWrite(
  payload: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
): boolean {
  const before = normalizedPolicy(existing ?? CREATE_BASELINE);
  const after = normalizedPolicy(effectiveRecord(payload, existing));
  return POLICY_FIELDS.some((field) => before[field] !== after[field]);
}

export function validatePolicyWrite(
  payload: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
): PolicyFieldError[] {
  if (!isPolicyWrite(payload, existing)) return [];

  const effective = effectiveRecord(payload, existing);
  const errors: PolicyFieldError[] = [];
  if (!hasPolicy(effective)) {
    errors.push({ field: 'creditPolicyNote', message: 'Store instructions are required' });
  }
  if (!hasContact(effective)) {
    errors.push({
      field: 'contact',
      message: 'Add a contact email, phone, or representative email',
    });
  }
  return errors;
}
