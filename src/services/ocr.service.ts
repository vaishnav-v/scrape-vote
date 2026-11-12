import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { logger } from './logger.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function toWslPath(winPath: string): string {
  return winPath
    .replace(/^[a-zA-Z]:/, (match) => `/mnt/${match[0]?.toLowerCase() ?? 'c'}`)
    .replace(/\\/g, '/');
}

interface OcrJob {
  imagePath: string;
  runnerImagePath: string;
  resolve: (text: string) => void;
  timer?: NodeJS.Timeout;
}

interface PipeMessage {
  status?: string;
  text?: string;
  success?: boolean;
  error?: string;
}

function resolveEasyOcrScript(): string {
  const candidates = [
    path.resolve(__dirname, '../../python/solve_easyocr.py'),
    path.resolve(process.cwd(), 'python/solve_easyocr.py'),
    path.resolve(process.cwd(), 'solve_easyocr.py'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export class OcrService {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pendingQueue: OcrJob[] = [];
  private currentJob: OcrJob | null = null;
  private isReady = false;
  private isShuttingDown = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly scriptPath: string;

  constructor() {
    this.scriptPath = resolveEasyOcrScript();
    if (env.ocrEnabled) {
      this.initProcess();
    } else {
      logger.info('[OCR Service] OCR_ENABLED=false; manual captcha mode only.');
    }
  }

  get ready(): boolean {
    return this.isReady;
  }

  get queueSize(): number {
    return this.pendingQueue.length + (this.currentJob ? 1 : 0);
  }

  private formatScriptPath(filePath: string): string {
    return env.ocrUseWsl ? toWslPath(filePath) : filePath;
  }

  private getSpawnArgs(extraArgs: string[]): { command: string; args: string[] } {
    const targetScript = this.formatScriptPath(this.scriptPath);
    if (env.ocrUseWsl) {
      return {
        command: 'wsl',
        args: [env.pythonBin, targetScript, ...extraArgs],
      };
    }
    return {
      command: env.pythonBin,
      args: [targetScript, ...extraArgs],
    };
  }

  private initProcess(): void {
    if (this.isShuttingDown || !env.ocrEnabled) return;

    const { command, args } = this.getSpawnArgs(['--pipe']);
    logger.info(`[OCR Service] Starting persistent EasyOCR worker: ${command} ${args.join(' ')}`);

    try {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process = child;

      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed) as PipeMessage;
            if (data.status === 'ready') {
              logger.info('[OCR Service] EasyOCR model loaded and ready.');
              this.isReady = true;
              this.processNext();
            } else if (this.currentJob) {
              const job = this.currentJob;
              this.currentJob = null;
              job.resolve(data.text || '');
              this.processNext();
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[OCR Service] Response parse error:', trimmed, msg);
            if (this.currentJob) {
              const job = this.currentJob;
              this.currentJob = null;
              job.resolve('');
              this.processNext();
            }
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          logger.warn('[OCR Service Stderr]:', text);
        }
      });

      child.on('close', (code) => {
        this.isReady = false;
        this.process = null;
        if (this.currentJob) {
          const job = this.currentJob;
          this.currentJob = null;
          job.resolve('');
        }

        if (this.isShuttingDown) return;

        logger.warn(
          `[OCR Service] Worker exited with code ${code ?? 'null'}. Reconnecting in ${env.ocrReconnectDelayMs}ms...`,
        );
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.initProcess();
        }, env.ocrReconnectDelayMs);
      });

      child.on('error', (err) => {
        logger.error('[OCR Service] Spawn error:', err.message);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[OCR Service] Failed to start worker:', msg);
    }
  }

  private processNext(): void {
    if (
      this.isShuttingDown ||
      this.currentJob ||
      this.pendingQueue.length === 0 ||
      !this.isReady ||
      !this.process
    ) {
      return;
    }

    const job = this.pendingQueue.shift();
    if (!job) return;
    this.currentJob = job;

    const originalResolve = job.resolve;
    job.resolve = (result: string) => {
      if (job.timer) clearTimeout(job.timer);
      originalResolve(result);
    };

    job.timer = setTimeout(() => {
      logger.warn(`[OCR Service] Pipe timed out for ${job.imagePath}. Killing hung worker...`);
      if (this.currentJob === job) {
        this.currentJob = null;
      }
      if (this.process) {
        this.process.kill('SIGKILL');
      }
      void this.solveCliFallback(job.imagePath).then(job.resolve);
    }, env.ocrPipeTimeoutMs);

    const payload = `${JSON.stringify({ image: job.runnerImagePath })}\n`;
    try {
      this.process.stdin.write(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[OCR Service] Write to stdin failed:', msg);
      if (this.currentJob === job) {
        this.currentJob = null;
      }
      job.resolve('');
      this.processNext();
    }
  }

  solve(imagePath: string): Promise<string> {
    if (!env.ocrEnabled || this.isShuttingDown) {
      return Promise.resolve('');
    }

    return new Promise((resolve) => {
      this.pendingQueue.push({
        imagePath,
        runnerImagePath: this.formatScriptPath(imagePath),
        resolve,
      });
      this.processNext();
    });
  }

  private solveCliFallback(imagePath: string): Promise<string> {
    return new Promise((resolve) => {
      const { command, args } = this.getSpawnArgs([this.formatScriptPath(imagePath)]);
      execFile(
        command,
        args,
        { timeout: env.ocrCliTimeoutMs },
        (err, stdout) => {
          if (err) {
            logger.error('[OCR Service] CLI fallback error:', err.message);
            resolve('');
          } else {
            resolve((stdout || '').trim());
          }
        },
      );
    });
  }

  shutdown(): void {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.currentJob) {
      const job = this.currentJob;
      this.currentJob = null;
      job.resolve('');
    }

    while (this.pendingQueue.length > 0) {
      const queued = this.pendingQueue.shift();
      queued?.resolve('');
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}

