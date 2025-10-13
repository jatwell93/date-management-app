import { envConfig } from "../config/environment";

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta?: any;
}

export class Logger {
  private static formatLog(entry: LogEntry): string {
    const { timestamp, level, message, meta } = entry;
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  private static shouldLog(level: 'info' | 'warn' | 'error' | 'debug'): boolean {
    const logLevels = ['error', 'warn', 'info', 'debug'];
    const currentLogLevelIndex = logLevels.indexOf(envConfig.NODE_ENV === 'production' ? 'warn' : 'debug');
    const messageLevelIndex = logLevels.indexOf(level);

    return messageLevelIndex >= currentLogLevelIndex;
  }

  static info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: 'info', message, meta };
      console.log(this.formatLog(entry));
    }
  }

  static warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: 'warn', message, meta };
      console.warn(this.formatLog(entry));
    }
  }

  static error(message: string, meta?: any): void {
    if (this.shouldLog('error')) {
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: 'error', message, meta };
      console.error(this.formatLog(entry));
    }
  }

  static debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: 'debug', message, meta };
      console.log(this.formatLog(entry));
    }
  }
}