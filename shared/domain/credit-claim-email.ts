// Supplier claim email rendering, shared by both runtimes. The Express backend and
// the Cloudflare Worker must send suppliers the *same* email — a second copy of this
// renderer would drift silently, which is the failure mode that produced four
// disagreeing copies of the role vocabulary (#517). The transport differs per runtime
// (Resend SDK on Node, `fetch` on Workers); the body lives here.
//
// Input is a structural subset rather than either runtime's claim type: Prisma's
// `ClaimWithRelations` and the Worker's `CreditClaim` both satisfy it, so neither
// package has to import the other's types.

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

function escapeHtml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Every current interpolation sits in a text node, where an apostrophe is
      // harmless. Escaped anyway because this is now the canonical helper for both
      // runtimes: the first reuse inside a single-quoted attribute would otherwise
      // turn the omission into an injection point, and `&#39;` renders identically.
      .replace(/'/g, '&#39;')
  );
}

/** The claim fields the email body reads — nothing runtime-specific. */
export interface RenderableClaimLine {
  batchNumber: string | null;
  unitsClaimed: number;
  expectedCreditValue: number | null;
  photos: readonly unknown[];
}

export interface RenderableClaim {
  id: number;
  supplier: { name: string };
  expectedCreditValue: number | null;
  lines: readonly RenderableClaimLine[];
}

export interface RenderedClaimEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the supplier claim email from the claim + its lines. Pure and deterministic
 * so it is unit-testable and identical for the initial send and follow-ups (the
 * follow-up swaps the subject and the intro sentence for a reminder). Each line
 * reports batch, units claimed, expected credit and a photo count, which is what a
 * supplier needs to match the attachments to the lines and process the return.
 *
 * It reads nothing but `RenderableClaim` — no product relation, no SKU, no expiry
 * date. Those were available to the Prisma-shaped input this renderer started from;
 * the structural subset it takes now deliberately does not carry them.
 */
export function renderClaimEmail(
  claim: RenderableClaim,
  options: { followUp?: boolean } = {},
): RenderedClaimEmail {
  const supplierName = claim.supplier.name;
  const reference = `Claim #${claim.id}`;
  const subject = options.followUp
    ? `Follow-up: expired-stock credit claim — ${reference}`
    : `Expired-stock credit claim — ${reference}`;

  const rows = claim.lines.map((line) => {
    const batch = line.batchNumber ?? '—';
    const units = line.unitsClaimed;
    const expected =
      line.expectedCreditValue != null ? currency.format(line.expectedCreditValue) : 'TBC';
    return { batch, units, expected, photoCount: line.photos.length };
  });

  const intro = options.followUp
    ? `We have not yet received a response to ${reference}. Please review the expired-stock credit claim below.`
    : `Please find below our expired-stock credit claim for products supplied by ${supplierName}.`;

  const textLines = [
    intro,
    '',
    ...rows.map(
      (r) =>
        `- Batch ${r.batch} | ${r.units} units | expected credit ${r.expected} | ${r.photoCount} photo(s)`,
    ),
    '',
    claim.expectedCreditValue != null
      ? `Total expected credit: ${currency.format(claim.expectedCreditValue)}`
      : 'Total expected credit: to be confirmed',
    '',
    'Photos of the affected stock are attached. Please confirm the credit to our account.',
  ];

  const htmlRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.batch)}</td><td>${r.units}</td><td>${escapeHtml(r.expected)}</td><td>${r.photoCount}</td></tr>`,
    )
    .join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <p>${escapeHtml(intro)}</p>
      <table cellpadding="6" style="border-collapse: collapse;" border="1">
        <thead>
          <tr><th>Batch</th><th>Units</th><th>Expected credit</th><th>Photos</th></tr>
        </thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <p><strong>Total expected credit:</strong> ${
        claim.expectedCreditValue != null
          ? escapeHtml(currency.format(claim.expectedCreditValue))
          : 'to be confirmed'
      }</p>
      <p>Photos of the affected stock are attached. Please confirm the credit to our account.</p>
    </div>
  `.trim();

  return { subject, html, text: textLines.join('\n') };
}
