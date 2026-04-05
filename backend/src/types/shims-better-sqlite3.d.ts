declare module 'better-sqlite3' {
  import { EventEmitter } from 'events';

  export interface Statement {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    iterate?: (...params: unknown[]) => IterableIterator<unknown>;
  }

  export default class Database extends EventEmitter {
    constructor(filename?: string, options?: Record<string, unknown>);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma?(pragma: string, options?: Record<string, unknown>): unknown;
    close(): void;
  }
}
