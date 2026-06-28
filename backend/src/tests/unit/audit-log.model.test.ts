import { AuditLogModel } from '../../models/audit-log.model';

type MockDb = {
  run: jest.Mock;
  get: jest.Mock;
};

describe('AuditLogModel', () => {
  let db: MockDb;
  let model: AuditLogModel;

  beforeEach(() => {
    db = {
      run: vi.fn(),
      get: vi.fn(),
    };
    model = new AuditLogModel(db as unknown as never);
  });

  it('createTable runs the audit log DDL statement', async () => {
    db.run.mockResolvedValue(undefined);

    await model.createTable();

    expect(db.run).toHaveBeenCalledTimes(1);
    const ddlQuery = db.run.mock.calls[0][0] as string;
    expect(ddlQuery).toContain('CREATE TABLE IF NOT EXISTS audit_log');
    expect(ddlQuery).toContain('FOREIGN KEY (user_id) REFERENCES users(id)');
    expect(ddlQuery).toContain('FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)');
  });

  it('logChange inserts a row and maps the returned database shape', async () => {
    db.get.mockResolvedValue({
      id: 12,
      organization_id: 'org-123',
      user_id: 9,
      inventory_item_id: 33,
      change_description: 'Quantity adjusted by +4',
      created_at: '2026-04-12T10:00:00.000Z',
    });

    const result = await model.logChange(9, 33, 'Quantity adjusted by +4');

    expect(db.get).toHaveBeenCalledWith(
      expect.stringContaining(
        'INSERT INTO audit_log (user_id, inventory_item_id, change_description)',
      ),
      [9, 33, 'Quantity adjusted by +4'],
    );

    expect(result).toEqual({
      id: 12,
      organizationId: 'org-123',
      user_id: 9,
      inventory_item_id: 33,
      change_description: 'Quantity adjusted by +4',
      created_at: '2026-04-12T10:00:00.000Z',
    });
  });
});
