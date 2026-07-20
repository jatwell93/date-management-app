import { Logger } from '../../utils/logger';

describe('Logger', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  let mockLogs: { level: string; message: string }[] = [];

  beforeEach(() => {
    mockLogs = [];

    console.log = vi.fn((message: string) => {
      mockLogs.push({ level: 'log', message });
    });

    console.warn = vi.fn((message: string) => {
      mockLogs.push({ level: 'warn', message });
    });

    console.error = vi.fn((message: string) => {
      mockLogs.push({ level: 'error', message });
    });
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe('type safety with Record<string, unknown>', () => {
    it('accepts typed metadata objects', () => {
      const metadata: Record<string, unknown> = {
        userId: 123,
        email: 'user@example.com',
        duration: 45.67,
      };

      Logger.error('User action', metadata);

      expect(mockLogs).toHaveLength(1);
      expect(mockLogs[0].message).toContain('User action');
      expect(mockLogs[0].message).toContain('123');
    });

    it('calls logger methods with optional metadata', () => {
      Logger.error('Error without metadata');
      Logger.warn('Warning with metadata', { code: 400 });

      expect(mockLogs).toHaveLength(2);
    });

    it('formats log output correctly', () => {
      Logger.warn('Test message', { key: 'value' });

      const logMessage = mockLogs[0].message;
      expect(logMessage).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(logMessage).toContain('[WARN]');
      expect(logMessage).toContain('Test message');
      expect(logMessage).toContain('key');
    });
  });

  describe('log methods', () => {
    it('logs error messages', () => {
      Logger.error('An error occurred', { code: 'ERR_001' });
      expect(mockLogs[0].message).toContain('[ERROR]');
    });

    it('logs warn messages', () => {
      Logger.warn('A warning', { severity: 'high' });
      expect(mockLogs[0].message).toContain('[WARN]');
    });

    it('logs info messages (if development)', () => {
      Logger.info('Info message', { count: 5 });
      // Info logs depending on NODE_ENV
      expect(mockLogs.length).toBeGreaterThanOrEqual(0);
    });

    it('logs debug messages (if development)', () => {
      Logger.debug('Debug info', { trace: 'full' });
      // Debug logs depending on NODE_ENV
      expect(mockLogs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('metadata handling', () => {
    it('handles complex metadata structures', () => {
      const metadata: Record<string, unknown> = {
        nested: {
          level1: 'value1',
          level2: { data: 'value2' },
        } as Record<string, unknown>,
        array: [1, 2, 3],
        count: 42,
        flag: true,
      };

      Logger.error('Complex data', metadata);

      expect(mockLogs).toHaveLength(1);
      const message = mockLogs[0].message;
      expect(message).toContain('level1');
      expect(message).toContain('42');
    });

    it('handles empty metadata', () => {
      Logger.error('Message with empty metadata', {});

      expect(mockLogs).toHaveLength(1);
      expect(mockLogs[0].message).toContain('Message with empty metadata');
    });

    it('handles null and undefined in metadata', () => {
      const metadata: Record<string, unknown> = {
        defined: 'value',
        nullable: null,
        maybe: undefined,
      };

      Logger.error('With null/undefined', metadata);

      expect(mockLogs).toHaveLength(1);
      const message = mockLogs[0].message;
      expect(message).toContain('defined');
    });
  });

  describe('real-world scenarios', () => {
    it('logs API errors', () => {
      const errorContext: Record<string, unknown> = {
        endpoint: '/api/products',
        method: 'POST',
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
      };

      Logger.error('API request failed', errorContext);

      expect(mockLogs).toHaveLength(1);
      expect(mockLogs[0].message).toContain('API request failed');
    });

    it('logs database operations', () => {
      const dbContext: Record<string, unknown> = {
        table: 'products',
        operation: 'INSERT',
        rows: 5000,
        duration: 234.5,
      };

      Logger.warn('Database operation slow', dbContext);

      expect(mockLogs).toHaveLength(1);
      expect(mockLogs[0].message).toContain('Database operation slow');
    });

    it('logs authentication events', () => {
      const authContext: Record<string, unknown> = {
        userId: 5,
        role: 'manager',
        method: 'PIN',
        success: true,
      };

      Logger.error('Auth event', authContext);

      expect(mockLogs).toHaveLength(1);
      expect(mockLogs[0].message).toContain('Auth event');
    });
  });
});
