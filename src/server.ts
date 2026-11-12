import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { createApiRouter } from './routes/api.routes.js';
import { logger } from './services/logger.service.js';
import { OcrService } from './services/ocr.service.js';
import { ScraperPool } from './services/scraper.service.js';
import type { Combination } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDirectories(): void {
  for (const dir of [env.dataDir, env.downloadsDir, env.captchasDir, env.logsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function loadCombinations(): Combination[] {
  if (!fs.existsSync(env.combinationsFile)) {
    logger.warn(
      `[Server] Combinations file not found at "${env.combinationsFile}". Run "npm run fetch-combinations" to generate it.`,
    );
    return [];
  }

  try {
    const raw = fs.readFileSync(env.combinationsFile, 'utf8');
    const parsed = JSON.parse(raw) as Combination[];
    if (!Array.isArray(parsed)) {
      logger.warn('[Server] combinations.json does not contain a valid array.');
      return [];
    }
    logger.info(`[Server] Loaded ${parsed.length} polling-station combinations.`);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Server] Failed to parse combinations file: ${msg}`);
    return [];
  }
}

function resolvePublicDir(): string {
  const candidates = [
    path.resolve(__dirname, '../public'),
    path.resolve(process.cwd(), 'public'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

async function bootstrap(): Promise<void> {
  ensureDirectories();

  const combinations = loadCombinations();
  const ocrService = new OcrService();
  const pool = new ScraperPool(ocrService);
  await pool.init();

  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`[API] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
      });
    }
    next();
  });

  app.use(express.static(resolvePublicDir()));
  app.use('/downloads', express.static(env.downloadsDir));
  app.use('/captchas', express.static(env.captchasDir));

  app.use(
    '/api',
    createApiRouter({
      pool,
      ocrService,
      getCombinations: () => combinations,
    }),
  );

  const server = app.listen(env.port, env.host, () => {
    logger.info('======================================================');
    logger.info(`Scraper Server running at http://${env.host}:${env.port}`);
    logger.info(`Downloads folder: ${env.downloadsDir}`);
    logger.info(`Captchas folder:  ${env.captchasDir}`);
    logger.info(`OCR Enabled:      ${env.ocrEnabled} (WSL: ${env.ocrUseWsl})`);
    logger.info('======================================================');
  });

  const handleShutdown = async (signal: string): Promise<void> => {
    logger.info(`[Server] Received ${signal}. Shutting down gracefully...`);
    server.close();
    await pool.shutdown();
    ocrService.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('[Server] Fatal startup error:', err);
  process.exit(1);
});

