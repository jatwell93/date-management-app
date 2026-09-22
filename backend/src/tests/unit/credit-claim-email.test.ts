/**
 * Unit tests for the shared supplier claim email renderer.
 *
 * The renderer moved to `shared/domain/credit-claim-email.ts` so the Express backend
 * and the Workers runtime emit the same email; it had no test of its own on either
 * side before that move. These pin the parts a second copy would have been free to
 * drift on: the follow-up variant, the unknown-total wording, and the escaping.
 *
 * Lives under the backend's unit suite because that is where the other
 * `shared/domain` tests live (`credit-claim.test.ts`, `brand-supplier.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  renderClaimEmail,
  type RenderableClaim,
} from '../../../../shared/domain/credit-claim-email';

function claim(overrides: Partial<RenderableClaim> = {}): RenderableClaim {
  return {
    id: 7,
    supplier: { name: 'Acme Wholesale' },
    expectedCreditValue: 20,
    lines: [{ batchNumber: 'B-1', unitsClaimed: 6, expectedCreditValue: 20, photos: [{}, {}] }],
    ...overrides,
  };
}

describe('renderClaimEmail', () => {
  it('names the claim and the supplier on an initial send', () => {
    const email = renderClaimEmail(claim());

    expect(email.subject).toBe('Expired-stock credit claim — Claim #7');
    expect(email.text).toContain('products supplied by Acme Wholesale');
    expect(email.html).toContain('Acme Wholesale');
  });

  it('swaps both the subject and the intro for a follow-up', () => {
    const email = renderClaimEmail(claim(), { followUp: true });

    expect(email.subject).toBe('Follow-up: expired-stock credit claim — Claim #7');
    expect(email.text).toContain('We have not yet received a response to Claim #7');
    // The initial wording must be gone, not merely prefixed.
    expect(email.text).not.toContain('products supplied by');
  });

  it('reports batch, units, expected credit and photo count per line', () => {
    const email = renderClaimEmail(claim());

    expect(email.text).toContain('Batch B-1 | 6 units | expected credit $20.00 | 2 photo(s)');
    expect(email.html).toContain('<td>B-1</td><td>6</td><td>$20.00</td><td>2</td>');
  });

  it('says TBC rather than zero when a line has no known expected credit', () => {
    // An absent supplier ratio means *unknown*, and the email must not imply the
    // supplier owes nothing — the same distinction `expectedCredit` draws.
    const email = renderClaimEmail(
      claim({
        expectedCreditValue: null,
        lines: [{ batchNumber: null, unitsClaimed: 6, expectedCreditValue: null, photos: [] }],
      }),
    );

    expect(email.text).toContain('expected credit TBC');
    expect(email.text).toContain('Total expected credit: to be confirmed');
    expect(email.text).not.toContain('$0.00');
  });

  it('renders an em dash for a line with no batch number', () => {
    const email = renderClaimEmail(
      claim({
        lines: [{ batchNumber: null, unitsClaimed: 6, expectedCreditValue: 20, photos: [] }],
      }),
    );

    expect(email.text).toContain('Batch — |');
  });

  it('escapes HTML metacharacters in supplier-controlled text', () => {
    const email = renderClaimEmail(
      claim({
        supplier: { name: `Acme & Sons <script>alert("x")</script>` },
        lines: [
          {
            batchNumber: `B"1'2<3>4&5`,
            unitsClaimed: 6,
            expectedCreditValue: 20,
            photos: [],
          },
        ],
      }),
    );

    // Every metacharacter of the OWASP set, the apostrophe included: the renderer is
    // shared, so a future interpolation into a single-quoted attribute must already
    // be safe rather than needing this remembered.
    expect(email.html).toContain('B&quot;1&#39;2&lt;3&gt;4&amp;5');
    expect(email.html).not.toContain('<script>');
    // The plain-text part is not HTML and is deliberately left unescaped.
    expect(email.text).toContain(`B"1'2<3>4&5`);
  });
});
