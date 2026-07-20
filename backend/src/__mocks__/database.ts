const mockDb = {
  exec: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  })),
  transaction: vi.fn((cb) => cb),
  close: vi.fn(),
};

export const getDb = vi.fn(() => mockDb);
export const releaseDb = vi.fn();
export const closeDb = vi.fn(() => mockDb.close());
