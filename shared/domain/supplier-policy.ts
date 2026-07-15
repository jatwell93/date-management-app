export const POLICY_STATUSES = ['ATTACHED', 'MISSING'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface SupplierPolicyRecord {
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

function effectiveRecord(
  payload: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
): Required<SupplierPolicyRecord> {
  const base = existing ?? CREATE_BASELINE;
  return {
    creditPolicyNote:
      payload.creditPolicyNote === undefined
        ? (base.creditPolicyNote ?? '')
        : (normalizeText(payload.creditPolicyNote) ?? ''),
    policyWriteOffQty:
      payload.policyWriteOffQty === undefined
        ? (base.policyWriteOffQty ?? null)
        : payload.policyWriteOffQty,
    policyCreditQty:
      payload.policyCreditQty === undefined
        ? (base.policyCreditQty ?? null)
        : payload.policyCreditQty,
    followUpDays:
      payload.followUpDays === undefined ? (base.followUpDays ?? 7) : (payload.followUpDays ?? 7),
    representativeName:
      payload.representativeName === undefined
        ? (base.representativeName ?? null)
        : normalizeText(payload.representativeName),
    representativeEmail:
      payload.representativeEmail === undefined
        ? (base.representativeEmail ?? null)
        : normalizeText(payload.representativeEmail),
    contactEmail:
      payload.contactEmail === undefined
        ? (base.contactEmail ?? null)
        : normalizeText(payload.contactEmail),
    contactPhone:
      payload.contactPhone === undefined
        ? (base.contactPhone ?? null)
        : normalizeText(payload.contactPhone),
  };
}

function normalizedPolicy(record: SupplierPolicyRecord): NormalizedPolicy {
  const effective = effectiveRecord(record, null);
  return {
    creditPolicyNote: normalizeText(effective.creditPolicyNote) ?? '',
    policyWriteOffQty: effective.policyWriteOffQty,
    policyCreditQty: effective.policyCreditQty,
    followUpDays: effective.followUpDays,
    representativeName: normalizeText(effective.representativeName),
    representativeEmail: normalizeText(effective.representativeEmail),
  };
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
  if (
    !normalizeText(effective.contactEmail) &&
    !normalizeText(effective.contactPhone) &&
    !normalizeText(effective.representativeEmail)
  ) {
    errors.push({ field: 'contact', message: 'Add a contact email, phone, or representative email' });
  }
  return errors;
}
