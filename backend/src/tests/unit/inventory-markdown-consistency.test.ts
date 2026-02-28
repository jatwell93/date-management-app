import { InventoryService } from '../../services/inventory.service';

describe('InventoryService - Markdown Calculation Alignment', () => {
  let service: InventoryService;

  beforeEach(() => {
    service = new InventoryService('test-org');
  });

  describe('calculateMarkdownStatus methods should be consistent', () => {
    const testCases = [
      {
        name: 'expired date',
        expiryDate: '2020-01-01',
        expected: 'Expired',
      },
      {
        name: '5 days from expiry (Markdown 3)',
        expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Markdown 3',
      },
      {
        name: '10 days from expiry (Markdown 2)',
        expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Markdown 2',
      },
      {
        name: '14 days from expiry (Markdown 2)',
        expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Markdown 2',
      },
      {
        name: '20 days from expiry (Markdown 1)',
        expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Markdown 1',
      },
      {
        name: '30 days from expiry (Markdown 1)',
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Markdown 1',
      },
      {
        name: '45 days from expiry (Normal)',
        expiryDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Normal',
      },
      {
        name: '90 days from expiry (Normal)',
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        expected: 'Normal',
      },
      {
        name: 'empty expiry date',
        expiryDate: '',
        expected: 'Normal',
      },
      {
        name: 'null expiry date',
        expiryDate: null as any,
        expected: 'Normal',
      },
    ];

    testCases.forEach(({ name, expiryDate, expected }) => {
      it(`should return ${expected} for ${name}`, async () => {
        // Test sync method
        const syncResult = service.calculateMarkdownStatusSync(expiryDate);
        expect(syncResult).toBe(expected);

        // Test async method
        const asyncResult = await service.calculateMarkdownStatus(expiryDate);
        expect(asyncResult).toBe(expected);

        // Results should be identical
        expect(syncResult).toEqual(asyncResult);
      });
    });
  });

  it('should have accessible markdown thresholds', () => {
    expect(InventoryService['MARKDOWN_THRESHOLDS']).toBeDefined();
    expect(InventoryService['MARKDOWN_THRESHOLDS'].markdown3).toBe(7);
    expect(InventoryService['MARKDOWN_THRESHOLDS'].markdown2).toBe(14);
    expect(InventoryService['MARKDOWN_THRESHOLDS'].markdown1).toBe(30);
  });
});
