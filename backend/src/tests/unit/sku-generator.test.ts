import { generateSKU } from '../../utils/sku-generator';

describe('generateSKU', () => {
  it('creates uppercase SKUs with the requested prefix and random suffix', () => {
    const sku = generateSKU('ORG123');

    expect(sku).toMatch(/^ORG123-[A-Z0-9]+-[A-F0-9]{12}$/);
  });

  it('does not use Math.random for SKU entropy', () => {
    const randomSpy = vi.spyOn(Math, 'random');

    generateSKU();

    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
