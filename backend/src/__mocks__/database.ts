const mockDb = {
  exec: jest.fn(),
  prepare: jest.fn(() => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn(),
  })),
  transaction: jest.fn((cb) => cb),
  close: jest.fn(),
};

export const getDb = jest.fn(() => mockDb);
export const releaseDb = jest.fn();
export const closeDb = jest.fn(() => mockDb.close());
