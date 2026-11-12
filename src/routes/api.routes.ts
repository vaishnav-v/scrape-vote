import { Router } from 'express';
import { TASK_STATUS } from '../config/constants.js';
import { env } from '../config/env.js';
import {
  combineDownloadedWorkbooks,
  getExistingDownloads,
  getExpectedFilename,
} from '../services/excel.service.js';
import { OcrService } from '../services/ocr.service.js';
import { ScraperPool } from '../services/scraper.service.js';
import type {
  Combination,
  QueueItemInput,
  TaskSummaryDto,
  TreeMap,
} from '../types/index.js';

export interface ApiRouterDeps {
  pool: ScraperPool;
  ocrService: OcrService;
  getCombinations: () => Combination[];
}

export function createApiRouter({
  pool,
  ocrService,
  getCombinations,
}: ApiRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const combinations = getCombinations();
    const queuedTasks = pool.tasks.filter(
      (t) => t.status === TASK_STATUS.QUEUED,
    ).length;
    res.json({
      status: 'ok',
      ocrEnabled: env.ocrEnabled,
      ocrReady: ocrService.ready,
      ocrQueueSize: ocrService.queueSize,
      combinationsCount: combinations.length,
      totalTasks: pool.tasks.length,
      activeWorkers: pool.activeWorkers,
      queuedTasks,
    });
  });

  router.get('/tasks', (_req, res) => {
    const summary: TaskSummaryDto[] = pool.tasks.map((t) => ({
      id: t.id,
      wardText: t.ward.text,
      pollingStationText: t.pollingStation.text,
      status: t.status,
      hasCaptcha: Boolean(t.captchaImg),
      error: t.error,
      fileName: t.fileName,
      downloadedAt: t.downloadedAt,
      ocr: t.ocr || null,
    }));
    res.json(summary);
  });

  router.get('/task-ocr/:id', (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    const task = pool.tasks.find((t) => t.id === taskId);
    if (task && task.ocr) {
      res.json({
        taskId: task.id,
        wardText: task.ward.text,
        pollingStationText: task.pollingStation.text,
        status: task.status,
        ocr: task.ocr,
      });
    } else {
      res.status(404).json({ error: 'Task or OCR details not found.' });
    }
  });

  router.get('/captcha/:id', (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    const task = pool.tasks.find((t) => t.id === taskId);
    if (task && task.captchaImg) {
      const imgBuffer = Buffer.from(task.captchaImg, 'base64');
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': imgBuffer.length,
      });
      res.end(imgBuffer);
    } else {
      res.status(404).json({ error: 'Captcha not found or task not ready.' });
    }
  });

  router.post('/solve', (req, res) => {
    const { id, captcha } = req.body as { id?: string | number; captcha?: string };
    const taskId = Number.parseInt(String(id ?? ''), 10);
    if (!Number.isNaN(taskId) && typeof captcha === 'string' && captcha.trim()) {
      const ok = pool.submitCaptchaSolution(taskId, captcha.trim());
      if (ok) {
        res.json({ success: true });
        return;
      }
    }
    res.status(400).json({ error: 'Invalid task ID or missing captcha text.' });
  });

  router.post('/retry/:id', (req, res) => {
    const taskId = Number.parseInt(req.params.id, 10);
    if (pool.retryTask(taskId)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Cannot retry task in current state.' });
    }
  });

  router.post('/retry-all-failed', (_req, res) => {
    const retriedCount = pool.retryAllFailed();
    res.json({ success: true, retriedCount });
  });

  router.get('/tree', (_req, res) => {
    const combinations = getCombinations();
    const existingDownloads = getExistingDownloads(env.downloadsDir);
    const taskMap = new Map(
      pool.tasks.map((t) => [`${t.ward.value}_${t.pollingStation.value}`, t]),
    );

    const tree: TreeMap = {};

    for (const c of combinations) {
      const distText = c.district.text;
      const lbText = c.localBody.text;
      const wardText = c.ward.text;

      const distNode = (tree[distText] ??= {});
      const lbNode = (distNode[lbText] ??= {});
      const wardList = (lbNode[wardText] ??= []);

      const expectedFile = getExpectedFilename(c);
      const isDownloaded = existingDownloads.has(expectedFile);
      const activeTask = taskMap.get(`${c.ward.value}_${c.pollingStation.value}`);

      let status: TreeMap[string][string][string][number]['status'] = 'idle';
      if (isDownloaded) {
        status = 'downloaded';
      } else if (activeTask) {
        status = activeTask.status;
      }

      wardList.push({
        pollingStationValue: c.pollingStation.value,
        pollingStationText: c.pollingStation.text,
        wardValue: c.ward.value,
        wardText,
        localBodyValue: c.localBody.value,
        localBodyText: lbText,
        districtValue: c.district.value,
        districtText: distText,
        status,
        fileName: isDownloaded ? expectedFile : (activeTask?.fileName ?? null),
      });
    }

    res.json(tree);
  });

  router.post('/stop-all', (_req, res) => {
    const remaining = pool.stopAll();
    res.json({ success: true, remaining });
  });

  router.post('/queue-items', (req, res) => {
    const { items } = req.body as { items?: QueueItemInput[] };
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items must be an array.' });
      return;
    }

    const addedCount = pool.queueItems(items, getCombinations());
    res.json({ success: true, addedCount });
  });

  router.post('/queue-all', (_req, res) => {
    const addedCount = pool.queueAll(getCombinations());
    res.json({ success: true, addedCount });
  });

  router.post('/combine', (_req, res) => {
    try {
      const result = combineDownloadedWorkbooks({
        combinationsFile: env.combinationsFile,
        downloadsDir: env.downloadsDir,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ success: false, error: msg });
    }
  });

  return router;
}

