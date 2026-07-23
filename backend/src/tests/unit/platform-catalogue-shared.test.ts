import {
  isPlatformAdminUser,
  toCatalogueSeedRunDto,
} from '../../../../shared/domain/platform-catalogue';

describe('platform catalogue shared contracts', () => {
  it.each([
    [1, undefined],
    [1, ''],
    [1, '0'],
    [1, '-1'],
    [1, '1,two'],
    [1, '1,'],
  ])('fails closed for user %s with allowlist %s', (userId, allowlist) => {
    expect(isPlatformAdminUser(userId, allowlist)).toBe(false);
  });

  it('allows only a positive numeric user ID in an entirely valid list', () => {
    expect(isPlatformAdminUser(7, '2, 7,19')).toBe(true);
    expect(isPlatformAdminUser(8, '2, 7,19')).toBe(false);
  });

  it('normalizes SQL dates and numeric fields into the public DTO', () => {
    expect(
      toCatalogueSeedRunDto({
        id: '4',
        version: '3',
        seededAt: new Date('2026-07-23T01:02:03.000Z'),
        sourceFileName: 'master.xlsx',
        inserted: '1',
        updated: 2,
        unchanged: '3',
        retired: 4,
        reinstated: '5',
        errorCount: 0,
      }),
    ).toEqual({
      id: 4,
      version: 3,
      seededAt: '2026-07-23T01:02:03.000Z',
      sourceFileName: 'master.xlsx',
      inserted: 1,
      updated: 2,
      unchanged: 3,
      retired: 4,
      reinstated: 5,
      errorCount: 0,
    });
  });
});
