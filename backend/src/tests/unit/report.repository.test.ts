import { ReportRepository } from '../../repositories/report.repository';

describe('ReportRepository', () => {
  it('returns dashboard summary data from the expected query sequence', () => {
    const totalProductsStatement = { get: jest.fn().mockReturnValue({ count: 100 }) };
    const expiringSoonStatement = { get: jest.fn().mockReturnValue({ count: 10 }) };
    const markdownItemsStatement = { get: jest.fn().mockReturnValue({ count: 5 }) };
    const recentActivity = [
      { id: 1, description: 'Created product', timestamp: '2026-05-01T00:00:00.000Z' },
    ];
    const recentActivityStatement = { all: jest.fn().mockReturnValue(recentActivity) };
    const db = {
      prepare: jest
        .fn()
        .mockReturnValueOnce(totalProductsStatement)
        .mockReturnValueOnce(expiringSoonStatement)
        .mockReturnValueOnce(markdownItemsStatement)
        .mockReturnValueOnce(recentActivityStatement),
    };

    const repository = new ReportRepository(db as never);

    expect(repository.getDashboardData()).toEqual({
      totalProducts: 100,
      expiringSoon: 10,
      markdownItems: 5,
      recentActivity,
    });
    expect(db.prepare).toHaveBeenCalledTimes(4);
    expect(totalProductsStatement.get).toHaveBeenCalledTimes(1);
    expect(expiringSoonStatement.get).toHaveBeenCalledTimes(1);
    expect(markdownItemsStatement.get).toHaveBeenCalledTimes(1);
    expect(recentActivityStatement.all).toHaveBeenCalledTimes(1);
  });
});
