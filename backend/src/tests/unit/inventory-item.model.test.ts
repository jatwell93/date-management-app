import { InventoryItemModel } from '../../models/inventory-item.model';

type MockDb = {
  run: jest.Mock;
  get: jest.Mock;
  all: jest.Mock;
};

describe('InventoryItemModel', () => {
  let db: MockDb;
  let model: InventoryItemModel;

  const baseRow = {
    id: 10,
    organization_id: 'org-1',
    product_id: 5,
    expiry_date: '2026-10-01',
    location_id: 3,
    status: 'Normal',
    created_at: '2026-04-12T00:00:00.000Z',
    updated_at: '2026-04-12T00:00:00.000Z',
  };

  beforeEach(() => {
    db = {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    };
    model = new InventoryItemModel(db as unknown as never);
  });

  it('createTable runs the inventory_items DDL', async () => {
    db.run.mockResolvedValue(undefined);

    await model.createTable();

    expect(db.run).toHaveBeenCalledTimes(1);
    const ddl = db.run.mock.calls[0][0] as string;
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS inventory_items');
    expect(ddl).toContain('FOREIGN KEY (product_id) REFERENCES products(id)');
    expect(ddl).toContain('FOREIGN KEY (location_id) REFERENCES store_areas(id)');
  });

  it('create inserts and maps the returned row', async () => {
    db.get.mockResolvedValue(baseRow);

    const result = await model.create({
      organizationId: 'org-1',
      productId: 5,
      expiryDate: '2026-10-01',
      locationId: 3,
      status: 'Normal',
    });

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining(
        'INSERT INTO inventory_items (product_id, expiry_date, location_id, status)',
      ),
      [5, '2026-10-01', 3, 'Normal'],
    );
    expect(result).toEqual({
      id: 10,
      organizationId: 'org-1',
      productId: 5,
      expiryDate: '2026-10-01',
      locationId: 3,
      status: 'Normal',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
    });
  });

  it('findById returns null when no row exists', async () => {
    db.get.mockResolvedValue(null);

    const result = await model.findById(999);

    expect(db.get).toHaveBeenCalledWith('SELECT * FROM inventory_items WHERE id = ?', [999]);
    expect(result).toBeNull();
  });

  it('findById maps a returned row', async () => {
    db.get.mockResolvedValue({ ...baseRow, status: 'Markdown 1' });

    const result = await model.findById(10);

    expect(result).toEqual({
      id: 10,
      organizationId: 'org-1',
      productId: 5,
      expiryDate: '2026-10-01',
      locationId: 3,
      status: 'Markdown 1',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
    });
  });

  it('findByProductId maps all rows in expiry order query', async () => {
    db.all.mockResolvedValue([{ ...baseRow }, { ...baseRow, id: 11, product_id: 5 }]);

    const result = await model.findByProductId(5);

    expect(db.all).toHaveBeenCalledWith(
      'SELECT * FROM inventory_items WHERE product_id = ? ORDER BY expiry_date',
      [5],
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(10);
    expect(result[1].id).toBe(11);
  });

  it('findByLocationId maps all rows in expiry order query', async () => {
    db.all.mockResolvedValue([{ ...baseRow, location_id: 9 }]);

    const result = await model.findByLocationId(9);

    expect(db.all).toHaveBeenCalledWith(
      'SELECT * FROM inventory_items WHERE location_id = ? ORDER BY expiry_date',
      [9],
    );
    expect(result).toEqual([
      {
        id: 10,
        organizationId: 'org-1',
        productId: 5,
        expiryDate: '2026-10-01',
        locationId: 9,
        status: 'Normal',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    ]);
  });

  it('update returns null when update payload is empty', async () => {
    const result = await model.update(10, {});

    expect(result).toBeNull();
    expect(db.get).not.toHaveBeenCalled();
  });

  it('update returns null when target row does not exist', async () => {
    db.get.mockResolvedValue(null);

    const result = await model.update(10, { status: 'Expired' });

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE inventory_items SET status = ?'),
      ['Expired', 10],
    );
    expect(result).toBeNull();
  });

  it('update maps the returned row for successful updates', async () => {
    db.get.mockResolvedValue({
      ...baseRow,
      status: 'Expired',
      updated_at: '2026-04-12T12:00:00.000Z',
    });

    const result = await model.update(10, { status: 'Expired' });

    expect(result).toEqual({
      id: 10,
      organizationId: 'org-1',
      productId: 5,
      expiryDate: '2026-10-01',
      locationId: 3,
      status: 'Expired',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T12:00:00.000Z',
    });
  });

  it('delete returns true when a row is deleted', async () => {
    db.run.mockResolvedValue({ changes: 1 });

    const result = await model.delete(10);

    expect(db.run).toHaveBeenCalledWith('DELETE FROM inventory_items WHERE id = ?', [10]);
    expect(result).toBe(true);
  });

  it('delete returns false when no rows are deleted', async () => {
    db.run.mockResolvedValue({ changes: 0 });

    const result = await model.delete(10);

    expect(result).toBe(false);
  });

  it('delete returns false when database returns null/undefined changes', async () => {
    db.run.mockResolvedValue({ changes: undefined });

    const result = await model.delete(10);

    expect(result).toBe(false);
  });
});
