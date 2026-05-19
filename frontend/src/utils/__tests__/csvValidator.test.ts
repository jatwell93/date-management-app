import { validateCSVColumns } from '../csvValidator';

describe('validateCSVColumns', () => {
  it('preserves first-match behavior for duplicate headers', async () => {
    const file = new File(
      ['SKU,sku,Name,Cost,Barcode\nfirst,second,Widget,1.23,123456789'],
      'catalog.csv',
      {
        type: 'text/csv',
      },
    );

    const result = await validateCSVColumns(file, 'product-catalog');

    expect(result.isValid).toBe(true);
    expect(result.foundColumns.sku).toBe('SKU');
  });
});
