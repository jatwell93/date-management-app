import { markdownConfigSchema } from '../../schemas';

const matrix = (percentage: number) => ({
  band1: { percentage, basis: 'cost' },
  band2: { percentage, basis: 'cost' },
  band3: { percentage, basis: 'cost' },
});

describe('markdown config request schema', () => {
  it('accepts both scoped matrices', () => {
    expect(
      markdownConfigSchema.safeParse({
        body: { matrices: { NO_CREDIT: matrix(20), FULL_CREDIT: matrix(30) } },
      }).success,
    ).toBe(true);
  });

  it('rejects a scoped update when either matrix is invalid', () => {
    expect(
      markdownConfigSchema.safeParse({
        body: {
          matrices: {
            NO_CREDIT: matrix(20),
            FULL_CREDIT: {
              band1: { percentage: 50, basis: 'cost' },
              band2: { percentage: 40, basis: 'cost' },
              band3: { percentage: 30, basis: 'cost' },
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('continues accepting the legacy bare matrix', () => {
    expect(markdownConfigSchema.safeParse({ body: matrix(20) }).success).toBe(true);
  });
});
