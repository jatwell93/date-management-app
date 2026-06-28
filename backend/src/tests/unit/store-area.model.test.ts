import { StoreAreaModel } from '../../models/store-area.model';

type MockDb = {
  get: jest.Mock;
  all: jest.Mock;
  run: jest.Mock;
};

describe('StoreAreaModel', () => {
  let db: MockDb;
  let model: StoreAreaModel;

  const baseRow = {
    id: 1,
    organization_id: 'org-1',
    name: 'Produce',
    sub_department: 'Fruit',
    last_checked: '2026-04-12T00:00:00.000Z',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
  };

  beforeEach(() => {
    db = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    };
    model = new StoreAreaModel(db as unknown as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createTable creates the table when it does not exist', async () => {
    db.get.mockResolvedValue(null);
    db.run.mockResolvedValue(undefined);

    await model.createTable();

    expect(db.get).toHaveBeenCalledWith(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='store_areas'",
    );
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run.mock.calls[0][0]).toContain('CREATE TABLE store_areas');
    expect(db.run.mock.calls[0][0]).toContain('UNIQUE(name, sub_department)');
  });

  it('createTable migrates old unique-name schema and reinserts existing rows', async () => {
    db.get.mockResolvedValue({ name: 'store_areas' });
    db.run.mockResolvedValue(undefined);

    db.all.mockImplementation(async (query: string) => {
      if (query.includes("pragma_index_list('store_areas')")) {
        return [{ name: 'idx_store_areas_name', unique: 1 }];
      }
      if (query.includes("pragma_index_info('idx_store_areas_name')")) {
        return [{ name: 'name' }];
      }
      if (query === 'SELECT * FROM store_areas') {
        return [baseRow];
      }
      return [];
    });

    await model.createTable();

    expect(db.run).toHaveBeenCalledWith('DROP TABLE store_areas');
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE store_areas'));
    expect(db.run).toHaveBeenCalledWith(
      'INSERT INTO store_areas (id, name, sub_department, last_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      baseRow.id,
      baseRow.name,
      baseRow.sub_department,
      baseRow.last_checked,
      baseRow.created_at,
      baseRow.updated_at,
    );
  });

  it('createTable rethrows migration errors', async () => {
    db.get.mockResolvedValue({ name: 'store_areas' });
    db.all.mockRejectedValue(new Error('pragma failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(model.createTable()).rejects.toThrow('pragma failure');
    expect(errorSpy).toHaveBeenCalledWith('Error during table migration:', expect.any(Error));
  });

  it('create inserts store area data and maps returned row', async () => {
    db.get.mockResolvedValue(baseRow);

    const result = await model.create({
      organizationId: 'org-1',
      name: 'Produce',
      subDepartment: 'Fruit',
      lastChecked: '2026-04-12T00:00:00.000Z',
    });

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO store_areas (name, sub_department, last_checked)'),
      ['Produce', 'Fruit', '2026-04-12T00:00:00.000Z'],
    );
    expect(result).toEqual({
      id: 1,
      organizationId: 'org-1',
      name: 'Produce',
      subDepartment: 'Fruit',
      lastChecked: '2026-04-12T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('findById returns null when no row exists', async () => {
    db.get.mockResolvedValue(null);

    const result = await model.findById(999);

    expect(db.get).toHaveBeenCalledWith('SELECT * FROM store_areas WHERE id = ?', [999]);
    expect(result).toBeNull();
  });

  it('findById maps and returns the row when found', async () => {
    db.get.mockResolvedValue(baseRow);

    const result = await model.findById(1);

    expect(result).toEqual({
      id: 1,
      organizationId: 'org-1',
      name: 'Produce',
      subDepartment: 'Fruit',
      lastChecked: '2026-04-12T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('findByName returns empty array when no rows are found', async () => {
    db.all.mockResolvedValue([]);

    const result = await model.findByName('Produce');

    expect(result).toEqual([]);
  });

  it('findByName maps all matching rows', async () => {
    db.all.mockResolvedValue([baseRow, { ...baseRow, id: 2, sub_department: null }]);

    const result = await model.findByName('Produce');

    expect(db.all).toHaveBeenCalledWith('SELECT * FROM store_areas WHERE name = ?', ['Produce']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].subDepartment).toBeNull();
  });

  it('findByNameAndSubDepartment returns null when no row exists', async () => {
    db.get.mockResolvedValue(null);

    const result = await model.findByNameAndSubDepartment('Produce', null);

    expect(db.get).toHaveBeenCalledWith(
      'SELECT * FROM store_areas WHERE name = ? AND ((sub_department IS NULL AND ? IS NULL) OR (sub_department = ?))',
      ['Produce', null, null],
    );
    expect(result).toBeNull();
  });

  it('findAll maps all rows sorted by name query', async () => {
    db.all.mockResolvedValue([baseRow]);

    const result = await model.findAll();

    expect(db.all).toHaveBeenCalledWith('SELECT * FROM store_areas ORDER BY name');
    expect(result).toEqual([
      {
        id: 1,
        organizationId: 'org-1',
        name: 'Produce',
        subDepartment: 'Fruit',
        lastChecked: '2026-04-12T00:00:00.000Z',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
  });

  it('update returns null when no fields are provided', async () => {
    const result = await model.update(1, {});

    expect(result).toBeNull();
    expect(db.get).not.toHaveBeenCalled();
  });

  it('update maps subDepartment field and returns updated row', async () => {
    db.get.mockResolvedValue({ ...baseRow, sub_department: 'Seasonal' });

    const result = await model.update(1, { subDepartment: 'Seasonal' });

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE store_areas SET sub_department = ?'),
      ['Seasonal', 1],
    );
    expect(result?.subDepartment).toBe('Seasonal');
  });

  it('delete returns true when row deletion count is greater than zero', async () => {
    db.run.mockResolvedValue({ changes: 1 });

    const result = await model.delete(1);

    expect(result).toBe(true);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM store_areas WHERE id = ?', [1]);
  });

  it('delete returns false when no rows are deleted', async () => {
    db.run.mockResolvedValue({ changes: 0 });

    const result = await model.delete(1);

    expect(result).toBe(false);
  });
});
