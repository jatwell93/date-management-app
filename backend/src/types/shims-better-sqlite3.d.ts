declare module "better-sqlite3" {
  import { EventEmitter } from "events";

  export interface Statement {
    run: (...params: any[]) => any;
    get: (...params: any[]) => any;
    all: (...params: any[]) => any[];
    iterate?: (...params: any[]) => IterableIterator<any>;
  }

  export default class Database extends EventEmitter {
    constructor(filename?: string, options?: any);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma?(pragma: string, options?: any): any;
    close(): void;
  }
}



