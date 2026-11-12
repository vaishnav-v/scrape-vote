import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { TASK_STATUS } from '../config/constants.js';
import { logger } from './logger.service.js';
import type { ScrapeTask } from '../types/index.js';

type PersistedTask = Omit<ScrapeTask, 'captchaImg'>;

let saveTimer: NodeJS.Timeout | null = null;

export function loadPersistedTasks(): ScrapeTask[] {
  try {
    if (!fs.existsSync(env.stateFile)) {
      return [];
    }
    const raw = fs.readFileSync(env.stateFile, 'utf8');
    const parsed = JSON.parse(raw) as PersistedTask[];
    if (!Array.isArray(parsed)) return [];

    // Re-queue interrupted in-flight tasks on startup so they resume cleanly
    return parsed.map((t) => {
      const wasInFlight =
        t.status === TASK_STATUS.RUNNING ||
        t.status === TASK_STATUS.OCR_SOLVING ||
        t.status === TASK_STATUS.AWAITING_CAPTCHA ||
        t.status === TASK_STATUS.SUBMITTING;

      return {
        ...t,
        retries: t.retries ?? 0,
        captchaImg: null,
        status: wasInFlight ? TASK_STATUS.QUEUED : t.status,
        error: wasInFlight ? null : t.error,
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[State] Failed to restore tasks from ${env.stateFile}: ${msg}`);
    return [];
  }
}

export function saveTasksNow(tasks: ScrapeTask[]): void {
  try {
    const dir = path.dirname(env.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Strip transient base64 captcha image buffers from persisted state
    const serializable: PersistedTask[] = tasks.map(({ captchaImg: _img, ...rest }) => rest);
    const tmpFile = `${env.stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(serializable, null, 2));
    fs.renameSync(tmpFile, env.stateFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[State] Failed to persist tasks: ${msg}`);
  }
}

export function scheduleSaveTasks(tasks: ScrapeTask[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveTasksNow(tasks);
  }, 400);
}

