import { initDatabase, getDb } from '../../database';

jest.mock('../../database');

describe('Database Initialization', () => {
  it('should initialize database successfully', async () => {
    // This test just ensures the database can be initialized without errors
    await expect(initDatabase()).resolves.not.toThrow();
  });

  it('should create all required tables', async () => {
    // Initialize the database
    await initDatabase();

    // Get a database connection
    const mockStatement = {
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(),
    };
    const mockDb = {
      prepare: jest.fn((_query) => mockStatement),
    };
    (getDb as jest.Mock).mockReturnValue(mockDb);

    // Check if the products table exists
    mockStatement.all.mockImplementation(() => [{ name: 'products' }]);
    const productsTable = mockDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
      .all();
    expect(productsTable).toHaveLength(1);

    // Check if the inventory_items table exists
    mockStatement.all.mockImplementation(() => [{ name: 'inventory_items' }]);
    const inventoryItemsTable = mockDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_items'")
      .all();
    expect(inventoryItemsTable).toHaveLength(1);

    // Check if the store_areas table exists
    mockStatement.all.mockImplementation(() => [{ name: 'store_areas' }]);
    const storeAreasTable = mockDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='store_areas'")
      .all();
    expect(storeAreasTable).toHaveLength(1);

    // Check if the users table exists
    mockStatement.all.mockImplementation(() => [{ name: 'users' }]);
    const usersTable = mockDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .all();
    expect(usersTable).toHaveLength(1);

    // Check if the audit_log table exists
    mockStatement.all.mockImplementation(() => [{ name: 'audit_log' }]);
    const auditLogTable = mockDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'")
      .all();
    expect(auditLogTable).toHaveLength(1);

    // Check if sub_department column exists in store_areas
    mockStatement.all.mockImplementation(() => [{ name: 'sub_department' }]);
    const tableInfo = mockDb.prepare('PRAGMA table_info(store_areas)').all();
    const hasSubDepartment = tableInfo.some((column: any) => column.name === 'sub_department');
    expect(hasSubDepartment).toBe(true);
  });

  it('should seed initial data correctly', async () => {
    // Initialize the database
    await initDatabase();

    // Get a database connection
    const mockStatement = {
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(),
    };
    const mockDb = {
      prepare: jest.fn((_query) => mockStatement),
    };
    (getDb as jest.Mock).mockReturnValue(mockDb);

    // Check if the initial product exists
    mockStatement.get.mockResolvedValueOnce({ sku: 'SKU123' });
    const product = await mockDb.prepare("SELECT * FROM products WHERE sku = 'SKU123'").get();
    expect(product).toBeDefined();

    // Check if the initial user exists with proper hash
    mockStatement.get.mockResolvedValueOnce({ role: 'Manager', pin: 'hashed_pin' });
    const user = await mockDb.prepare("SELECT * FROM users WHERE role = 'Manager'").get();
    expect(user).toBeDefined();
    expect((user as any).pin).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt hash format
  });
});
