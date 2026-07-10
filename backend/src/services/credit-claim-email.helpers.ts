import type { ClaimWithRelations } from '../repositories/credit-claim.repository';

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RenderedClaimEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the supplier claim email from the claim + its lines. Pure and deterministic
 * so it is unit-testable and identical for the initial send and follow-ups (the
 * follow-up just prepends a reminder note). Batch, SKU, units and expiry are the
 * fields suppliers require on a return; each line links back to its write-off's
 * product via the loaded relation.
 */
export function renderClaimEmail(
  claim: ClaimWithRelations,
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
      (r) => `- Batch ${r.batch} | ${r.units} units | expected credit ${r.expected} | ${r.photoCount} photo(s)`,
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
