import {
  resolveBayState,
  rollupCoverage,
  type BayCheckForCycle,
  type StoreWalkBay,
} from '../../../../shared/domain/store-walk-tracking';

describe('store walk tracking shared domain', () => {
  const cycleStartedAt = new Date('2026-07-09T09:00:00.000Z');

  const bay = (overrides: Partial<StoreWalkBay> = {}): StoreWalkBay => ({
    id: 1,
    name: 'Bay 1',
    parentId: 10,
    parentName: 'Vitamins',
    lastChecked: null,
    ...overrides,
  });

  const check = (overrides: Partial<BayCheckForCycle> = {}): BayCheckForCycle => ({
    storeAreaId: 1,
    checkedAt: new Date('2026-07-09T10:00:00.000Z'),
    userId: 7,
    checkerName: 'Avery',
    ...overrides,
  });

  it('marks a bay with a check in the active cycle as checked', () => {
    expect(resolveBayState(bay(), [check()], cycleStartedAt)).toEqual({
      state: 'checked',
      checkedAt: new Date('2026-07-09T10:00:00.000Z'),
      checkerName: 'Avery',
      userId: 7,
    });
  });

  it('marks a bay with no history as not checked', () => {
    expect(resolveBayState(bay(), [], cycleStartedAt)).toEqual({
      state: 'not_checked',
      checkedAt: null,
      checkerName: null,
      userId: null,
    });
  });

  it('marks a bay checked only before the active cycle as overdue', () => {
    expect(
      resolveBayState(
        bay({ lastChecked: new Date('2026-07-08T12:00:00.000Z') }),
        [],
        cycleStartedAt,
      ),
    ).toEqual({
      state: 'overdue',
      checkedAt: new Date('2026-07-08T12:00:00.000Z'),
      checkerName: null,
      userId: null,
    });
  });

  it('rolls up coverage by department and store', () => {
    const bays: StoreWalkBay[] = [
      bay({ id: 1, name: 'Bay 1', parentId: 10, parentName: 'Vitamins' }),
      bay({
        id: 2,
        name: 'Bay 2',
        parentId: 10,
        parentName: 'Vitamins',
        lastChecked: new Date('2026-07-08T12:00:00.000Z'),
      }),
      bay({ id: 3, name: 'Bay 3', parentId: 20, parentName: 'Beauty' }),
      bay({ id: 4, name: 'Bay 4', parentId: 20, parentName: 'Beauty' }),
    ];

    expect(
      rollupCoverage(bays, [check({ storeAreaId: 1 }), check({ storeAreaId: 3 })], cycleStartedAt),
    ).toEqual({
      store: {
        totalBays: 4,
        checkedBays: 2,
        notCheckedBays: 1,
        overdueBays: 1,
        coveragePercent: 50,
      },
      departments: [
        {
          departmentId: 10,
          departmentName: 'Vitamins',
          totalBays: 2,
          checkedBays: 1,
          notCheckedBays: 0,
          overdueBays: 1,
          coveragePercent: 50,
        },
        {
          departmentId: 20,
          departmentName: 'Beauty',
          totalBays: 2,
          checkedBays: 1,
          notCheckedBays: 1,
          overdueBays: 0,
          coveragePercent: 50,
        },
      ],
    });
  });
});
