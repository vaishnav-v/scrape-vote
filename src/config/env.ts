import 'dotenv/config';
import path from 'path';
import { z } from 'zod';

function booleanEnv(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (val === undefined || val === '') return defaultValue;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return val;
  }, z.boolean());
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  CONCURRENCY_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
  STAGGER_MIN_MS: z.coerce.number().int().min(0).default(1000),
  STAGGER_MAX_MS: z.coerce.number().int().min(0).default(3000),
  MAX_TASK_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  BROWSER_RECYCLE_AFTER: z.coerce.number().int().min(0).default(50),

  PLAYWRIGHT_HEADLESS: booleanEnv(true),
  PLAYWRIGHT_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  RESULT_WAIT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  BLOCK_NON_ESSENTIAL_ASSETS: booleanEnv(true),

  OCR_ENABLED: booleanEnv(true),
  OCR_USE_WSL: booleanEnv(false),
  PYTHON_BIN: z.string().min(1).default('python3'),
  OCR_PIPE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OCR_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  OCR_MIN_TEXT_LENGTH: z.coerce.number().int().min(1).max(10).default(4),
  OCR_RECONNECT_DELAY_MS: z.coerce.number().int().positive().default(3000),
  SAVE_CAPTCHA_DATASET: booleanEnv(true),

  DATA_DIR: z.string().min(1).default('.'),
  DOWNLOADS_DIR: z.string().optional(),
  CAPTCHAS_DIR: z.string().optional(),
  LOGS_DIR: z.string().optional(),
  COMBINATIONS_FILE: z.string().optional(),
  STATE_FILE: z.string().optional(),

  FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  FETCH_DELAY_MS: z.coerce.number().int().min(0).default(200),
  FETCH_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;
const dataDir = path.resolve(raw.DATA_DIR);

export const env = {
  port: raw.PORT,
  host: raw.HOST,

  concurrencyLimit: raw.CONCURRENCY_LIMIT,
  staggerMinMs: raw.STAGGER_MIN_MS,
  staggerMaxMs: Math.max(raw.STAGGER_MIN_MS, raw.STAGGER_MAX_MS),
  maxTaskRetries: raw.MAX_TASK_RETRIES,
  browserRecycleAfter: raw.BROWSER_RECYCLE_AFTER,

  playwrightHeadless: raw.PLAYWRIGHT_HEADLESS,
  playwrightNavTimeoutMs: raw.PLAYWRIGHT_NAV_TIMEOUT_MS,
  resultWaitTimeoutMs: raw.RESULT_WAIT_TIMEOUT_MS,
  blockNonEssentialAssets: raw.BLOCK_NON_ESSENTIAL_ASSETS,

  ocrEnabled: raw.OCR_ENABLED,
  ocrUseWsl: raw.OCR_USE_WSL,
  pythonBin: raw.PYTHON_BIN,
  ocrPipeTimeoutMs: raw.OCR_PIPE_TIMEOUT_MS,
  ocrCliTimeoutMs: raw.OCR_CLI_TIMEOUT_MS,
  ocrMinTextLength: raw.OCR_MIN_TEXT_LENGTH,
  ocrReconnectDelayMs: raw.OCR_RECONNECT_DELAY_MS,
  saveCaptchaDataset: raw.SAVE_CAPTCHA_DATASET,

  dataDir,
  downloadsDir: path.resolve(raw.DOWNLOADS_DIR || path.join(dataDir, 'downloads')),
  captchasDir: path.resolve(raw.CAPTCHAS_DIR || path.join(dataDir, 'captchas')),
  logsDir: path.resolve(raw.LOGS_DIR || path.join(dataDir, 'logs')),
  combinationsFile: path.resolve(raw.COMBINATIONS_FILE || path.join(dataDir, 'combinations.json')),
  stateFile: path.resolve(raw.STATE_FILE || path.join(dataDir, 'tasks-state.json')),

  fetchConcurrency: raw.FETCH_CONCURRENCY,
  fetchDelayMs: raw.FETCH_DELAY_MS,
  fetchRetries: raw.FETCH_RETRIES,
} as const;

export type AppConfig = typeof env;

