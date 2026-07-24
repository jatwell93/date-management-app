import type { NeonQueryFunction } from '@neondatabase/serverless';
import type {
  BulkAttachResult,
  BulkLinkResult,
  Database,
  PolicyReviewItem,
  Supplier,
} from './database';

type SupplierCreditDatabase = Pick<
  Database,
  | 'listSuppliers'
  | 'findSupplier'
  | 'createSupplier'
  | 'updateSupplier'
  | 'clearSupplierPolicy'
  | 'listPolicyReview'
  | 'bulkAttachSupplier'
  | 'bulkLinkProducts'
>;

function toIsoStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: Number(row.id),
    name: String(row.name),
    creditType: row.creditType === 'FULL_CREDIT' ? 'FULL_CREDIT' : 'NONE',
    contactEmail: (row.contactEmail as string | null) ?? null,
    contactPhone: (row.contactPhone as string | null) ?? null,
    creditPolicyNote: String(row.creditPolicyNote ?? ''),
    policyWriteOffQty: row.policyWriteOffQty == null ? null : Number(row.policyWriteOffQty),
    policyCreditQty: row.policyCreditQty == null ? null : Number(row.policyCreditQty),
    followUpDays: row.followUpDays == null ? 7 : Number(row.followUpDays),
    representativeName: (row.representativeName as string | null) ?? null,
    representativeEmail: (row.representativeEmail as string | null) ?? null,
    policyUpdatedAt: toIsoStringOrNull(row.policyUpdatedAt),
  };
}

function toPolicyReviewItem(row: Record<string, unknown>): PolicyReviewItem {
  const supplier =
    row.supplierId == null
      ? null
      : toSupplier({ ...row, id: row.supplierId, name: row.supplierName });
  return {
    brandId: Number(row.brandId),
    brandName: String(row.brandName),
    supplier,
    status: row.status === 'ATTACHED' ? 'ATTACHED' : 'MISSING',
    policyUpdatedAt: supplier?.policyUpdatedAt ?? null,
    representativeName: supplier?.representativeName ?? null,
  };
}

function toBulkAttachResult(row: Record<string, unknown>): BulkAttachResult {
  if (Number(row.supplierFound) === 0) return { kind: 'SUPPLIER_NOT_FOUND' };
  if (!row.hasPolicy) return { kind: 'SUPPLIER_POLICY_MISSING' };
  if (Number(row.requestedCount) !== Number(row.foundCount)) return { kind: 'BRAND_NOT_FOUND' };
  const attached = Number(row.attached);
  return {
    kind: 'SUCCESS',
    attached,
    unchanged: Number(row.requestedCount) - attached,
    corrections: Number(row.corrections),
  };
}

function toBulkLinkResult(
  row: Record<string, unknown>,
  requestedBrandId: number | null,
): BulkLinkResult {
  if (requestedBrandId != null && row.brandId == null) return { kind: 'BRAND_NOT_FOUND' };
  if (Number(row.requestedCount) !== Number(row.foundCount)) return { kind: 'PRODUCT_NOT_FOUND' };
  if (Number(row.conflictCount) > 0) return { kind: 'BRAND_CONFLICT' };
  const linked = Number(row.linked);
  return {
    kind: 'SUCCESS',
    brandId: Number(row.brandId),
    linked,
    alreadyLinked: Number(row.requestedCount) - linked,
    corrections: Number(row.corrections),
  };
}

export function createSupplierCreditDatabase(
  sql: NeonQueryFunction<false, false>,
): SupplierCreditDatabase {
  return {
    async listSuppliers(organizationId) {
      const rows = (await sql`
        SELECT id, name, credit_type AS "creditType",
               contact_email AS "contactEmail", contact_phone AS "contactPhone",
               credit_policy_note AS "creditPolicyNote",
               policy_write_off_qty AS "policyWriteOffQty",
               policy_credit_qty AS "policyCreditQty", follow_up_days AS "followUpDays",
               representative_name AS "representativeName",
               representative_email AS "representativeEmail",
               policy_updated_at AS "policyUpdatedAt"
        FROM suppliers
        WHERE organization_id = ${organizationId}
        ORDER BY name ASC
      `) as Array<Record<string, unknown>>;
      return rows.map(toSupplier);
    },

    async findSupplier(organizationId, id) {
      const rows = (await sql`
        SELECT id, name, credit_type AS "creditType",
               contact_email AS "contactEmail", contact_phone AS "contactPhone",
               credit_policy_note AS "creditPolicyNote",
               policy_write_off_qty AS "policyWriteOffQty",
               policy_credit_qty AS "policyCreditQty", follow_up_days AS "followUpDays",
               representative_name AS "representativeName",
               representative_email AS "representativeEmail",
               policy_updated_at AS "policyUpdatedAt"
        FROM suppliers
        WHERE organization_id = ${organizationId} AND id = ${id}
        LIMIT 1
      `) as Array<Record<string, unknown>>;
      return rows[0] ? toSupplier(rows[0]) : null;
    },

    async createSupplier(organizationId, data) {
      const rows = (await sql`
        INSERT INTO suppliers (
          organization_id, name, credit_type, contact_email, contact_phone, credit_policy_note,
          policy_write_off_qty, policy_credit_qty, follow_up_days,
          representative_name, representative_email, policy_updated_at,
          created_at, updated_at
        ) VALUES (
          ${organizationId}, ${data.name}, ${data.creditType}, ${data.contactEmail}, ${data.contactPhone},
          ${data.creditPolicyNote}, ${data.policyWriteOffQty}, ${data.policyCreditQty},
          ${data.followUpDays}, ${data.representativeName}, ${data.representativeEmail},
          ${data.policyUpdatedAt}, NOW(), NOW()
        )
        RETURNING id, name, credit_type AS "creditType",
          contact_email AS "contactEmail", contact_phone AS "contactPhone",
          credit_policy_note AS "creditPolicyNote",
          policy_write_off_qty AS "policyWriteOffQty",
          policy_credit_qty AS "policyCreditQty", follow_up_days AS "followUpDays",
          representative_name AS "representativeName",
          representative_email AS "representativeEmail",
          policy_updated_at AS "policyUpdatedAt"
      `) as Array<Record<string, unknown>>;
      return toSupplier(rows[0]);
    },

    async updateSupplier(organizationId, id, data) {
      const rows = (await sql`
        UPDATE suppliers SET
          name = ${data.name}, credit_type = ${data.creditType}, contact_email = ${data.contactEmail},
          contact_phone = ${data.contactPhone}, credit_policy_note = ${data.creditPolicyNote},
          policy_write_off_qty = ${data.policyWriteOffQty},
          policy_credit_qty = ${data.policyCreditQty}, follow_up_days = ${data.followUpDays},
          representative_name = ${data.representativeName},
          representative_email = ${data.representativeEmail},
          policy_updated_at = ${data.policyUpdatedAt}, updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${id}
        RETURNING id, name, credit_type AS "creditType",
          contact_email AS "contactEmail", contact_phone AS "contactPhone",
          credit_policy_note AS "creditPolicyNote",
          policy_write_off_qty AS "policyWriteOffQty",
          policy_credit_qty AS "policyCreditQty", follow_up_days AS "followUpDays",
          representative_name AS "representativeName",
          representative_email AS "representativeEmail",
          policy_updated_at AS "policyUpdatedAt"
      `) as Array<Record<string, unknown>>;
      return rows[0] ? toSupplier(rows[0]) : null;
    },

    async clearSupplierPolicy(organizationId, id) {
      const rows = (await sql`
        UPDATE suppliers SET
          credit_type = 'NONE', credit_policy_note = '', policy_write_off_qty = NULL, policy_credit_qty = NULL,
          follow_up_days = 7, representative_name = NULL, representative_email = NULL,
          policy_updated_at = NOW(), updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${id}
        RETURNING id, name, credit_type AS "creditType",
          contact_email AS "contactEmail", contact_phone AS "contactPhone",
          credit_policy_note AS "creditPolicyNote",
          policy_write_off_qty AS "policyWriteOffQty",
          policy_credit_qty AS "policyCreditQty", follow_up_days AS "followUpDays",
          representative_name AS "representativeName",
          representative_email AS "representativeEmail",
          policy_updated_at AS "policyUpdatedAt"
      `) as Array<Record<string, unknown>>;
      return rows[0] ? toSupplier(rows[0]) : null;
    },

    async listPolicyReview(organizationId, options) {
      const brandFilter = options.brand?.trim() || null;
      const supplierFilter = options.supplier?.trim() || null;
      const statusFilter = options.status ?? null;
      const rows = (await sql`
        SELECT b.id AS "brandId", b.name AS "brandName",
               s.id AS "supplierId", s.name AS "supplierName", s.credit_type AS "creditType",
               s.contact_email AS "contactEmail", s.contact_phone AS "contactPhone",
               s.credit_policy_note AS "creditPolicyNote",
               s.policy_write_off_qty AS "policyWriteOffQty",
               s.policy_credit_qty AS "policyCreditQty", s.follow_up_days AS "followUpDays",
               s.representative_name AS "representativeName",
               s.representative_email AS "representativeEmail",
               s.policy_updated_at AS "policyUpdatedAt",
               CASE WHEN LENGTH(BTRIM(COALESCE(s.credit_policy_note, ''))) > 0
                    THEN 'ATTACHED' ELSE 'MISSING' END AS status
        FROM brands b
        LEFT JOIN suppliers s
          ON s.id = b.supplier_id AND s.organization_id = b.organization_id
        WHERE b.organization_id = ${organizationId}
          AND (${brandFilter}::text IS NULL OR LOWER(b.name) LIKE '%' || LOWER(${brandFilter}) || '%')
          AND (${supplierFilter}::text IS NULL OR LOWER(s.name) LIKE '%' || LOWER(${supplierFilter}) || '%'
               OR s.id::text = ${supplierFilter})
          AND (${statusFilter}::text IS NULL OR
               CASE WHEN LENGTH(BTRIM(COALESCE(s.credit_policy_note, ''))) > 0
                    THEN 'ATTACHED' ELSE 'MISSING' END = ${statusFilter})
        ORDER BY (s.policy_updated_at IS NOT NULL) ASC,
                 s.policy_updated_at ASC, b.name ASC, b.id ASC
      `) as Array<Record<string, unknown>>;
      return rows.map(toPolicyReviewItem);
    },

    async bulkAttachSupplier(organizationId, supplierId, brandIds, createdByUserId) {
      const rows = (await sql`
        WITH requested AS (
          SELECT DISTINCT UNNEST(${brandIds}::integer[]) AS id
        ), supplier_state AS (
          SELECT COUNT(*)::int AS found,
                 COALESCE(BOOL_OR(LENGTH(BTRIM(credit_policy_note)) > 0), FALSE) AS has_policy
          FROM suppliers
          WHERE id = ${supplierId} AND organization_id = ${organizationId}
        ), brand_state AS (
          SELECT COUNT(r.id)::int AS requested_count, COUNT(b.id)::int AS found_count
          FROM requested r
          LEFT JOIN brands b ON b.id = r.id AND b.organization_id = ${organizationId}
        ), valid AS (
          SELECT ss.found = 1 AND ss.has_policy
                 AND bs.requested_count = bs.found_count AS can_write
          FROM supplier_state ss CROSS JOIN brand_state bs
        ), changed AS (
          UPDATE brands b
          SET supplier_id = ${supplierId}, source = 'CONFIRMED', updated_at = NOW()
          FROM requested r, valid v
          WHERE v.can_write AND b.id = r.id AND b.organization_id = ${organizationId}
            AND b.supplier_id IS DISTINCT FROM ${supplierId}
          RETURNING b.id
        ), corrections AS (
          INSERT INTO catalogue_corrections (
            organization_id, brand_id, chosen_supplier_id, kind, status,
            created_by_user_id, created_at, updated_at
          )
          SELECT ${organizationId}, c.id, ${supplierId}, 'SUPPLIER_OVERRIDE', 'PENDING',
                 ${createdByUserId}, NOW(), NOW()
          FROM changed c
          RETURNING id
        )
        SELECT ss.found AS "supplierFound", ss.has_policy AS "hasPolicy",
               bs.requested_count AS "requestedCount", bs.found_count AS "foundCount",
               (SELECT COUNT(*)::int FROM changed) AS attached,
               (SELECT COUNT(*)::int FROM corrections) AS corrections
        FROM supplier_state ss CROSS JOIN brand_state bs
      `) as Array<Record<string, unknown>>;
      return toBulkAttachResult(rows[0]);
    },

    async bulkLinkProducts(organizationId, target, productIds, createdByUserId) {
      const brandId = target.brandId ?? null;
      const brandName = target.brandName ?? null;
      const rows = (await sql`
        WITH requested AS (
          SELECT DISTINCT UNNEST(${productIds}::integer[]) AS id
        ), existing_target AS (
          SELECT id, name, supplier_id
          FROM brands
          WHERE organization_id = ${organizationId}
            AND ((${brandId}::integer IS NOT NULL AND id = ${brandId}::integer)
              OR (${brandId}::integer IS NULL AND name = ${brandName}::text))
          LIMIT 1
        ), product_state AS (
          SELECT COUNT(r.id)::int AS requested_count,
                 COUNT(p.id)::int AS found_count,
                 COUNT(*) FILTER (
                   WHERE p.brand_id IS NOT NULL
                     AND (t.id IS NULL OR p.brand_id <> t.id)
                 )::int AS conflict_count
          FROM requested r
          LEFT JOIN products p ON p.id = r.id AND p.organization_id = ${organizationId}
          LEFT JOIN existing_target t ON TRUE
        ), brand_row AS (
          INSERT INTO brands (organization_id, name, source, created_at, updated_at)
          SELECT ${organizationId}, ${brandName}::text, 'USER_ADDED', NOW(), NOW()
          FROM product_state ps
          WHERE ${brandId}::integer IS NULL
            AND ps.requested_count = ps.found_count AND ps.conflict_count = 0
          ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, name, supplier_id
        ), target_brand AS (
          SELECT id, name, supplier_id FROM existing_target
          UNION ALL
          SELECT id, name, supplier_id FROM brand_row
          WHERE NOT EXISTS (SELECT 1 FROM existing_target)
        ), changed AS (
          UPDATE products p
          SET brand_id = t.id, updated_at = NOW()
          FROM requested r CROSS JOIN target_brand t CROSS JOIN product_state ps
          WHERE ps.requested_count = ps.found_count AND ps.conflict_count = 0
            AND p.id = r.id AND p.organization_id = ${organizationId}
            AND p.brand_id IS NULL
          RETURNING p.id, p.barcode, t.id AS brand_id, t.name AS brand_name, t.supplier_id
        ), corrections AS (
          INSERT INTO catalogue_corrections (
            organization_id, product_id, brand_id, barcode, entered_brand_name,
            chosen_supplier_id, kind, status, created_by_user_id, created_at, updated_at
          )
          SELECT ${organizationId}, c.id, c.brand_id, NULLIF(BTRIM(c.barcode), ''),
                 c.brand_name, c.supplier_id, 'BRAND_ADDED', 'PENDING',
                 ${createdByUserId}, NOW(), NOW()
          FROM changed c
          RETURNING id
        )
        SELECT ps.requested_count AS "requestedCount", ps.found_count AS "foundCount",
               ps.conflict_count AS "conflictCount",
               (SELECT id FROM target_brand LIMIT 1) AS "brandId",
               (SELECT COUNT(*)::int FROM changed) AS linked,
               (SELECT COUNT(*)::int FROM corrections) AS corrections
        FROM product_state ps
      `) as Array<Record<string, unknown>>;
      return toBulkLinkResult(rows[0], brandId);
    },
  };
}
