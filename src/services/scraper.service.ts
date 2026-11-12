import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  BLOCKED_RESOURCE_TYPES,
  CAPTCHA_ERROR_KEYWORDS,
  DROPDOWN_POLL_TIMEOUT_MS,
  DROPDOWN_SETTLE_DELAY_MS,
  OCR_STATUS,
  POST_SUBMIT_CHECK_DELAY_MS,
  SEC_SELECTORS,
  SEC_URLS,
  TASK_STATUS,
} from '../config/constants.js';
import { env } from '../config/env.js';
import {
  formatVotersTable,
  getExpectedFilename,
  saveVoterExcel,
} from './excel.service.js';
import { logger } from './logger.service.js';
import { OcrService } from './ocr.service.js';
import { loadPersistedTasks, saveTasksNow, scheduleSaveTasks } from './state.service.js';
import type { Combination, QueueItemInput, ScrapeTask } from '../types/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScraperPool {
  public tasks: ScrapeTask[] = [];
  public readonly solveResolvers = new Map<number, (captcha: string) => void>();
  public concurrencyLimit: number;
  public activeWorkers = 0;

  private browser: Browser | null = null;
  private tasksProcessedSinceLaunch = 0;
  private isRecycling = false;
  private isShuttingDown = false;
  private nextTaskId = 1;

  constructor(private readonly ocrService: OcrService) {
    this.concurrencyLimit = env.concurrencyLimit;
    this.tasks = loadPersistedTasks();
    if (this.tasks.length > 0) {
      const maxId = Math.max(...this.tasks.map((t) => t.id));
      this.nextTaskId = maxId + 1;
      logger.info(`[Pool] Restored ${this.tasks.length} tasks from state file.`);
    }
  }

  async init(): Promise<void> {
    logger.info('[Pool] Initializing Playwright Chromium browser...');
    this.browser = await chromium.launch({ headless: env.playwrightHeadless });
    this.tasksProcessedSinceLaunch = 0;
    this.startWorkers();
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: env.playwrightHeadless });
      this.tasksProcessedSinceLaunch = 0;
    }
    return this.browser;
  }

  private async maybeRecycleBrowser(): Promise<void> {
    if (
      this.isShuttingDown ||
      this.isRecycling ||
      env.browserRecycleAfter <= 0 ||
      this.activeWorkers > 0 ||
      this.tasksProcessedSinceLaunch < env.browserRecycleAfter
    ) {
      return;
    }

    this.isRecycling = true;
    try {
      logger.info(
        `[Pool] Recycling Chromium browser after ${this.tasksProcessedSinceLaunch} tasks...`,
      );
      if (this.browser) {
        await this.browser.close().catch(() => null);
        this.browser = null;
      }
      await this.ensureBrowser();
    } finally {
      this.isRecycling = false;
      this.startWorkers();
    }
  }

  startWorkers(): void {
    if (this.isShuttingDown || this.isRecycling) return;

    while (this.activeWorkers < this.concurrencyLimit) {
      const nextTask = this.tasks.find((t) => t.status === TASK_STATUS.QUEUED);
      if (!nextTask) break;
      this.activeWorkers++;
      void this.runWorker(nextTask);
    }
  }

  private createTaskFromCombination(c: Combination): ScrapeTask {
    return {
      id: this.nextTaskId++,
      district: c.district,
      localBody: c.localBody,
      ward: c.ward,
      pollingStation: c.pollingStation,
      language: c.language,
      status: TASK_STATUS.QUEUED,
      captchaImg: null,
      error: null,
      fileName: null,
      downloadedAt: null,
      retries: 0,
      ocr: {
        lastImageFile: null,
        lastImageUrl: null,
        lastPredictedText: null,
        status: OCR_STATUS.IDLE,
        history: [],
      },
    };
  }

  queueItems(items: QueueItemInput[], combinations: Combination[]): number {
    const existingKeys = new Set(
      this.tasks.map((t) => `${t.ward.value}_${t.pollingStation.value}`),
    );
    const comboLookup = new Map(
      combinations.map((c) => [`${c.ward.value}_${c.pollingStation.value}`, c]),
    );

    let addedCount = 0;
    for (const item of items) {
      const key = `${item.wardValue}_${item.pollingStationValue}`;
      if (existingKeys.has(key)) continue;

      const combo = comboLookup.get(key);
      if (combo) {
        this.tasks.push(this.createTaskFromCombination(combo));
        existingKeys.add(key);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      const activeOrQueued = this.tasks.filter(
        (t) =>
          t.status === TASK_STATUS.QUEUED ||
          t.status === TASK_STATUS.RUNNING ||
          t.status === TASK_STATUS.AWAITING_CAPTCHA ||
          t.status === TASK_STATUS.OCR_SOLVING,
      ).length;
      this.concurrencyLimit = activeOrQueued > 1 ? env.concurrencyLimit : 1;
      scheduleSaveTasks(this.tasks);
      this.startWorkers();
    }

    return addedCount;
  }

  queueAll(combinations: Combination[]): number {
    const existingKeys = new Set(
      this.tasks.map((t) => `${t.ward.value}_${t.pollingStation.value}`),
    );
    let addedCount = 0;

    for (const combo of combinations) {
      const key = `${combo.ward.value}_${combo.pollingStation.value}`;
      if (existingKeys.has(key)) continue;

      this.tasks.push(this.createTaskFromCombination(combo));
      existingKeys.add(key);
      addedCount++;
    }

    if (addedCount > 0) {
      this.concurrencyLimit = env.concurrencyLimit;
      scheduleSaveTasks(this.tasks);
      this.startWorkers();
    }

    return addedCount;
  }

  retryTask(taskId: number): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (
      task &&
      (task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.COMPLETED)
    ) {
      task.status = TASK_STATUS.QUEUED;
      task.captchaImg = null;
      task.error = null;
      task.fileName = null;
      task.retries = 0;
      scheduleSaveTasks(this.tasks);
      this.startWorkers();
      return true;
    }
    return false;
  }

  retryAllFailed(): number {
    let count = 0;
    for (const task of this.tasks) {
      if (task.status === TASK_STATUS.FAILED) {
        task.status = TASK_STATUS.QUEUED;
        task.captchaImg = null;
        task.error = null;
        task.retries = 0;
        count++;
      }
    }
    if (count > 0) {
      scheduleSaveTasks(this.tasks);
      this.startWorkers();
    }
    return count;
  }

  stopAll(): number {
    for (const task of this.tasks) {
      if (task.status === TASK_STATUS.AWAITING_CAPTCHA) {
        const resolver = this.solveResolvers.get(task.id);
        if (resolver) {
          resolver('');
          this.solveResolvers.delete(task.id);
        }
      }
    }

    this.tasks = this.tasks.filter(
      (t) =>
        t.status !== TASK_STATUS.QUEUED &&
        t.status !== TASK_STATUS.AWAITING_CAPTCHA,
    );
    scheduleSaveTasks(this.tasks);
    return this.tasks.length;
  }

  submitCaptchaSolution(taskId: number, captcha: string): boolean {
    const resolver = this.solveResolvers.get(taskId);
    if (resolver && captcha) {
      this.solveResolvers.delete(taskId);
      resolver(captcha);
      return true;
    }
    return false;
  }

  private async selectOptionAndWait(
    page: Page,
    selectSelector: string,
    optionValue: string,
    dependentSelectSelector?: string,
  ): Promise<void> {
    await page.waitForFunction(
      ({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        if (!el) return false;
        return Array.from(el.options).some((opt) => opt.value === val);
      },
      { sel: selectSelector, val: optionValue },
      { timeout: DROPDOWN_POLL_TIMEOUT_MS },
    );

    await page.evaluate(
      ({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        if (!el) throw new Error(`Select element not found: ${sel}`);
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { sel: selectSelector, val: optionValue },
    );

    if (dependentSelectSelector) {
      await page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (!el) return false;
            return Array.from(el.options).some((opt) => opt.value !== '');
          },
          dependentSelectSelector,
          { timeout: DROPDOWN_POLL_TIMEOUT_MS },
        )
        .catch(() => null);
    }

    await page.waitForTimeout(DROPDOWN_SETTLE_DELAY_MS);
  }

  private async runWorker(task: ScrapeTask): Promise<void> {
    task.status = TASK_STATUS.RUNNING;
    task.error = null;
    scheduleSaveTasks(this.tasks);

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    const staggerRange = Math.max(0, env.staggerMaxMs - env.staggerMinMs);
    const staggerMs = Math.floor(Math.random() * staggerRange) + env.staggerMinMs;
    if (staggerMs > 0) {
      logger.info(`[Task ${task.id}] Staggering start by ${staggerMs}ms...`);
      await sleep(staggerMs);
    }

    if (this.isShuttingDown) {
      this.activeWorkers--;
      return;
    }

    try {
      const browser = await this.ensureBrowser();
      context = await browser.newContext();
      page = await context.newPage();

      if (env.blockNonEssentialAssets) {
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (BLOCKED_RESOURCE_TYPES.has(type)) {
            return route.abort();
          }
          return route.continue();
        });
      }

      logger.info(`[Task ${task.id}] Navigating to voters list page...`);
      await page.goto(SEC_URLS.VOTERS_LIST, {
        waitUntil: 'domcontentloaded',
        timeout: env.playwrightNavTimeoutMs,
      });

      await this.selectOptionAndWait(
        page,
        SEC_SELECTORS.DISTRICT_SELECT,
        task.district.value,
        SEC_SELECTORS.LOCAL_BODY_SELECT,
      );
      await this.selectOptionAndWait(
        page,
        SEC_SELECTORS.LOCAL_BODY_SELECT,
        task.localBody.value,
        SEC_SELECTORS.WARD_SELECT,
      );
      await this.selectOptionAndWait(
        page,
        SEC_SELECTORS.WARD_SELECT,
        task.ward.value,
        SEC_SELECTORS.POLLING_STATION_SELECT,
      );
      await this.selectOptionAndWait(
        page,
        SEC_SELECTORS.POLLING_STATION_SELECT,
        task.pollingStation.value,
      );
      await this.selectOptionAndWait(
        page,
        SEC_SELECTORS.LANGUAGE_SELECT,
        task.language.value,
      );

      let success = false;
      let forceManualNext = !env.ocrEnabled;

      while (!success && !this.isShuttingDown) {
        const captchaLocator = page.locator(SEC_SELECTORS.CAPTCHA_IMG);
        await captchaLocator.waitFor({ state: 'visible', timeout: 10000 });

        const imageFileName = `task_${task.id}_${Date.now()}.png`;
        const imageFilePath = path.join(env.captchasDir, imageFileName);
        await captchaLocator.screenshot({ path: imageFilePath });

        const captchaBuffer = fs.readFileSync(imageFilePath);
        task.captchaImg = captchaBuffer.toString('base64');
        task.ocr.lastImageFile = imageFileName;
        task.ocr.lastImageUrl = `/captchas/${imageFileName}`;

        let solvedText = '';
        let isManualSubmission = false;

        if (!forceManualNext && env.ocrEnabled) {
          logger.info(`[Task ${task.id}] Running EasyOCR on ${imageFileName}...`);
          task.status = TASK_STATUS.OCR_SOLVING;
          task.ocr.status = OCR_STATUS.OCR_RUNNING;

          const predicted = await this.ocrService.solve(imageFilePath);
          logger.info(`[Task ${task.id}] EasyOCR prediction: "${predicted}"`);
          task.ocr.lastPredictedText = predicted;

          if (predicted && predicted.length >= env.ocrMinTextLength) {
            solvedText = predicted;
            task.status = TASK_STATUS.SUBMITTING;
            logger.info(`[Task ${task.id}] Auto-submitting with OCR: "${solvedText}"...`);
          } else {
            logger.info(
              `[Task ${task.id}] OCR uncertain ("${predicted}"). Falling back to manual input.`,
            );
            task.error = `OCR uncertain ("${predicted || 'empty'}"). Please solve manually.`;
            task.ocr.status = OCR_STATUS.FAILED_AUTO;
            task.ocr.history.push({
              imageFile: imageFileName,
              predictedText: predicted || '',
              status: 'ocr_uncertain',
              timestamp: new Date().toISOString(),
            });
            isManualSubmission = true;
          }
        } else {
          isManualSubmission = true;
        }

        if (isManualSubmission) {
          task.status = TASK_STATUS.AWAITING_CAPTCHA;
          scheduleSaveTasks(this.tasks);
          logger.info(`[Task ${task.id}] Awaiting manual captcha input...`);

          solvedText = await new Promise<string>((resolve) => {
            this.solveResolvers.set(task.id, resolve);
          });

          if (!solvedText || this.isShuttingDown) {
            throw new Error('Manual captcha solving cancelled.');
          }

          task.status = TASK_STATUS.SUBMITTING;
          task.ocr.status = OCR_STATUS.MANUAL_INPUT;
          task.error = null;
        }

        await page.fill(SEC_SELECTORS.CAPTCHA_INPUT, solvedText);
        logger.info(`[Task ${task.id}] Submitting form with captcha "${solvedText}"...`);
        await page.click(SEC_SELECTORS.SUBMIT_BUTTON);

        await page.waitForTimeout(POST_SUBMIT_CHECK_DELAY_MS);
        const errorMsg = await page.evaluate((selector) => {
          const alerts = Array.from(document.querySelectorAll(selector));
          return alerts
            .map((a) => a.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
        }, SEC_SELECTORS.ERROR_ALERTS);

        const lowerErr = errorMsg.toLowerCase();
        if (CAPTCHA_ERROR_KEYWORDS.some((kw) => lowerErr.includes(kw))) {
          logger.info(`[Task ${task.id}] Submission rejected with text "${solvedText}".`);

          task.ocr.history.push({
            imageFile: imageFileName,
            submittedText: solvedText,
            isManual: isManualSubmission,
            status: 'rejected',
            timestamp: new Date().toISOString(),
          });

          if (!isManualSubmission) {
            task.error = `OCR predicted "${solvedText}" (rejected). Please solve manually:`;
            task.ocr.status = OCR_STATUS.FAILED_AUTO;
          } else {
            task.error = 'Incorrect captcha. Please try again.';
          }

          forceManualNext = true;
          task.status = TASK_STATUS.AWAITING_CAPTCHA;
          continue;
        }

        logger.info(`[Task ${task.id}] Form submitted, waiting for results...`);
        const resultLoaded = await page
          .waitForFunction(
            (sel) => {
              const el = document.querySelector(sel);
              return Boolean(el && el.innerHTML.trim() !== '');
            },
            SEC_SELECTORS.RESULT_CONTAINER,
            { timeout: env.resultWaitTimeoutMs },
          )
          .catch(() => null);

        if (!resultLoaded) {
          throw new Error(
            `Results failed to load or empty output after ${env.resultWaitTimeoutMs / 1000} seconds.`,
          );
        }

        let finalImageName = imageFileName;
        if (env.saveCaptchaDataset && fs.existsSync(imageFilePath)) {
          const safeText = solvedText.replace(/[^a-zA-Z0-9_-]/g, '');
          finalImageName = `${safeText}_${imageFileName}`;
          const labeledImagePath = path.join(env.captchasDir, finalImageName);
          fs.renameSync(imageFilePath, labeledImagePath);
          task.ocr.lastImageFile = finalImageName;
          task.ocr.lastImageUrl = `/captchas/${finalImageName}`;
        } else if (fs.existsSync(imageFilePath)) {
          fs.unlinkSync(imageFilePath);
          task.ocr.lastImageFile = null;
          task.ocr.lastImageUrl = null;
        }

        task.ocr.history.push({
          imageFile: finalImageName,
          submittedText: solvedText,
          isManual: isManualSubmission,
          status: isManualSubmission ? 'manual_success' : 'auto_success',
          timestamp: new Date().toISOString(),
        });
        task.ocr.status = isManualSubmission
          ? OCR_STATUS.MANUAL_SUCCESS
          : OCR_STATUS.AUTO_SUCCESS;

        logger.info(`[Task ${task.id}] Extracting table data...`);
        const rawTableData = await page.evaluate((selector) => {
          const tables = Array.from(document.querySelectorAll(selector));
          if (tables.length === 0) return null;
          const rows: string[][] = [];
          for (const table of tables) {
            const trs = Array.from(table.querySelectorAll('tr'));
            for (const tr of trs) {
              const cells = Array.from(tr.querySelectorAll('td, th')).map((c) =>
                (c.textContent ?? '').trim().replace(/\s+/g, ' '),
              );
              if (cells.length > 0) rows.push(cells);
            }
          }
          return rows;
        }, SEC_SELECTORS.RESULT_TABLES);

        const formattedTable = formatVotersTable(rawTableData);
        const fileName = getExpectedFilename(task);
        const savePath = path.join(env.downloadsDir, fileName);

        const rawFallback =
          !formattedTable || formattedTable.length === 0
            ? await page.innerText(SEC_SELECTORS.RESULT_CONTAINER)
            : '';

        logger.info(`[Task ${task.id}] Saving Excel: ${fileName}...`);
        saveVoterExcel(savePath, formattedTable, rawFallback);

        task.fileName = fileName;
        task.status = TASK_STATUS.COMPLETED;
        task.downloadedAt = new Date().toISOString();
        task.captchaImg = null;
        success = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Task ${task.id}] Worker Error:`, msg);

      if (!this.isShuttingDown && task.retries < env.maxTaskRetries) {
        task.retries += 1;
        task.status = TASK_STATUS.QUEUED;
        task.error = `Retry ${task.retries}/${env.maxTaskRetries}: ${msg}`;
        task.captchaImg = null;
        logger.warn(
          `[Task ${task.id}] Re-queueing (attempt ${task.retries}/${env.maxTaskRetries})...`,
        );
      } else {
        task.status = TASK_STATUS.FAILED;
        task.error = msg;
      }
    } finally {
      if (page) {
        await page.close().catch(() => null);
      }
      if (context) {
        await context.close().catch(() => null);
      }
      this.activeWorkers--;
      this.tasksProcessedSinceLaunch++;
      scheduleSaveTasks(this.tasks);
      await this.maybeRecycleBrowser();
      this.startWorkers();
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    for (const [, resolver] of this.solveResolvers) {
      resolver('');
    }
    this.solveResolvers.clear();

    saveTasksNow(this.tasks);

    if (this.browser) {
      await this.browser.close().catch(() => null);
      this.browser = null;
    }
  }
}

