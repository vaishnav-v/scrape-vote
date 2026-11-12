import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

function ensureLogsDir(): void {
  if (!fs.existsSync(env.logsDir)) {
    fs.mkdirSync(env.logsDir, { recursive: true });
  }
}

function formatMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

function writeLog(level: 'INFO' | 'WARN' | 'ERROR', args: unknown[]): void {
  ensureLogsDir();
  const ts = new Date().toISOString();
  const msg = formatMessage(args);
  const line = `[${ts}] ${level}: ${msg}\n`;

  try {
    fs.appendFileSync(path.join(env.logsDir, 'scraper.log'), line);
    if (level === 'ERROR') {
      fs.appendFileSync(path.join(env.logsDir, 'scraper_error.log'), `[${ts}] ${msg}\n`);
    }
  } catch {
    // Avoid crashing if log filesystem write fails
  }

  if (level === 'ERROR') {
    console.error(`[${ts}] ERROR:`, ...args);
  } else if (level === 'WARN') {
    console.warn(`[${ts}] WARN:`, ...args);
  } else {
    console.log(`[${ts}] INFO:`, ...args);
  }
}

export const logger = {
  info: (...args: unknown[]): void => writeLog('INFO', args),
  warn: (...args: unknown[]): void => writeLog('WARN', args),
  error: (...args: unknown[]): void => writeLog('ERROR', args),
};

