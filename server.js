import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { spawn, execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PORT = config.port || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Create downloads & captchas directories
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

const captchasDir = path.join(__dirname, 'captchas');
if (!fs.existsSync(captchasDir)) {
  fs.mkdirSync(captchasDir, { recursive: true });
}
app.use('/captchas', express.static(captchasDir));

// Helper to convert Windows paths to WSL paths
function toWslPath(winPath) {
  return winPath.replace(/^[a-zA-Z]:/, (match) => `/mnt/${match[0].toLowerCase()}`).replace(/\\/g, '/');
}

// --------------------------------------------------------
// EasyOCR Service (Runs via WSL Pipe with CLI Fallback)
// --------------------------------------------------------
class OcrService {
  constructor() {
    this.process = null;
    this.pendingQueue = [];
    this.currentJob = null;
    this.isReady = false;
    this.initProcess();
  }

  initProcess() {
    const scriptPath = toWslPath(path.join(__dirname, 'solve_easyocr.py'));
    console.log(`[OCR Service] Starting persistent EasyOCR worker: wsl python3 ${scriptPath} --pipe`);

    try {
      this.process = spawn('wsl', ['python3', scriptPath, '--pipe']);

      let buffer = '';
      this.process.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // keep trailing incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.status === 'ready') {
              console.log("[OCR Service] EasyOCR model loaded and ready in WSL.");
              this.isReady = true;
              this.processNext();
            } else if (this.currentJob) {
              const job = this.currentJob;
              this.currentJob = null;
              job.resolve(data.text || '');
              this.processNext();
            }
          } catch (err) {
            console.error("[OCR Service] Response parse error:", line, err.message);
            if (this.currentJob) {
              const job = this.currentJob;
              this.currentJob = null;
              job.resolve('');
              this.processNext();
            }
          }
        }
      });

      this.process.stderr.on('data', (chunk) => {
        // console.warn("[OCR Service Stderr]:", chunk.toString());
      });

      this.process.on('close', (code) => {
        console.warn(`[OCR Service] Process closed with code ${code}. Reconnecting in 3s...`);
        this.isReady = false;
        this.process = null;
        if (this.currentJob) {
          const job = this.currentJob;
          this.currentJob = null;
          job.resolve('');
        }
        setTimeout(() => this.initProcess(), 3000);
      });

      this.process.on('error', (err) => {
        console.error("[OCR Service] Spawn error:", err.message);
      });
    } catch (e) {
      console.error("[OCR Service] Failed to start:", e.message);
    }
  }

  processNext() {
    if (this.currentJob || this.pendingQueue.length === 0 || !this.isReady || !this.process) {
      return;
    }
    this.currentJob = this.pendingQueue.shift();
    const payload = JSON.stringify({ image: this.currentJob.wslPath }) + '\n';
    try {
      this.process.stdin.write(payload);
    } catch (err) {
      console.error("[OCR Service] Write to stdin failed:", err.message);
      const job = this.currentJob;
      this.currentJob = null;
      job.resolve('');
      this.processNext();
    }
  }

  solve(imagePath) {
    return new Promise((resolve) => {
      const wslPath = toWslPath(imagePath);

      // Fallback timeout in case pipe hangs (7s)
      const timer = setTimeout(() => {
        console.warn(`[OCR Service] Timeout for ${imagePath}, running CLI fallback...`);
        this.solveCliFallback(imagePath).then(resolve);
      }, 7000);

      this.pendingQueue.push({
        wslPath,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        }
      });

      this.processNext();
    });
  }

  solveCliFallback(imagePath) {
    return new Promise((resolve) => {
      const scriptPath = toWslPath(path.join(__dirname, 'solve_easyocr.py'));
      const wslImagePath = toWslPath(imagePath);
      execFile('wsl', ['python3', scriptPath, wslImagePath], { timeout: config.timeouts?.ocrCli || 15000 }, (err, stdout) => {
        if (err) {
          console.error("[OCR Service] CLI fallback error:", err.message);
          resolve('');
        } else {
          resolve((stdout || '').trim());
        }
      });
    });
  }
}

const ocrService = new OcrService();

// --------------------------------------------------------
// Combinations & Downloads Management
// --------------------------------------------------------
let rawCombinations = [];
try {
  rawCombinations = JSON.parse(fs.readFileSync(path.join(__dirname, 'combinations.json'), 'utf8'));
} catch (err) {
  console.error("Failed to read combinations.json. Run node find-combinations.js first!");
  process.exit(1);
}

const getExpectedFilename = (c) => {
  const parts = [
    c.district.text,
    c.localBody.text,
    c.ward.text,
    c.pollingStation.text
  ];
  const cleanParts = parts.map(p => p.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_'));
  return `${cleanParts.join('_')}.xlsx`;
};

const getExistingDownloads = () => {
  try {
    return new Set(fs.readdirSync(downloadsDir));
  } catch (err) {
    return new Set();
  }
};

// Split combined Age/Gender column into separate columns
function formatVotersTable(tableData) {
  if (!tableData || tableData.length === 0) return tableData;

  const header = tableData[0];
  let ageGenderIndex = -1;

  for (let i = 0; i < header.length; i++) {
    const colName = header[i].toLowerCase();
    if (colName.includes('age') && (colName.includes('gender') || colName.includes('sex') || colName.includes('m/f') || colName.includes('male/female') || colName.includes('f/m'))) {
      ageGenderIndex = i;
      break;
    }
  }

  if (ageGenderIndex === -1 && tableData.length > 1) {
    for (let col = 0; col < tableData[1].length; col++) {
      const val = String(tableData[1][col]);
      if (val.includes('/') && (val.toLowerCase().includes('m') || val.toLowerCase().includes('f') || val.toLowerCase().includes('male') || val.toLowerCase().includes('female'))) {
        ageGenderIndex = col;
        break;
      }
    }
  }

  if (ageGenderIndex !== -1) {
    const formattedData = [];
    const newHeader = [...header];
    newHeader.splice(ageGenderIndex, 1, "Age", "Gender");
    formattedData.push(newHeader);

    for (let r = 1; r < tableData.length; r++) {
      const row = [...tableData[r]];
      const combinedVal = String(row[ageGenderIndex] || '');
      
      let age = '';
      let gender = '';

      if (combinedVal.includes('/')) {
        const parts = combinedVal.split('/');
        age = parts[0].trim();
        gender = parts[1].trim();
      } else {
        const ageMatch = combinedVal.match(/\d+/);
        const genderMatch = combinedVal.match(/[a-zA-Z]+/);
        if (ageMatch) age = ageMatch[0];
        if (genderMatch) gender = genderMatch[0];
      }

      row.splice(ageGenderIndex, 1, age, gender);
      formattedData.push(row);
    }
    return formattedData;
  }

  return tableData;
}

// Compute column widths for cleaner excel sheets
function applyColWidths(ws, data) {
  if (!data || data.length === 0) return;
  
  const colWidths = data[0].map(() => 10);
  
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const val = String(data[r][c] || '');
      if (val.length > colWidths[c]) {
        colWidths[c] = val.length;
      }
    }
  }
  
  ws['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w + 3, 8), 40) }));
}

// --------------------------------------------------------
// Scraper Pool with Automated OCR & Manual Fallback
// --------------------------------------------------------
let tasks = [];
const solveResolvers = new Map();

class ScraperPool {
  constructor(concurrencyLimit = 1) {
    this.concurrencyLimit = concurrencyLimit;
    this.activeWorkers = 0;
    this.browser = null;
  }

  async init() {
    console.log("Initializing Playwright browser worker pool...");
    this.browser = await chromium.launch({ headless: true });
    this.startWorkers();
  }

  startWorkers() {
    while (this.activeWorkers < this.concurrencyLimit) {
      const nextTask = tasks.find(t => t.status === 'queued');
      if (!nextTask) break;
      this.activeWorkers++;
      this.runWorker(nextTask);
    }
  }

  async runWorker(task) {
    task.status = 'running';
    task.error = null;
    let page = null;

    // Stagger start by 1-4 seconds to prevent multiple workers from hitting the API simultaneously
    const staggerMs = Math.floor(Math.random() * ((config.staggerMaxMs || 4000) - (config.staggerMinMs || 1000))) + (config.staggerMinMs || 1000);
    console.log(`[Task ${task.id}] Staggering start by ${staggerMs}ms to avoid rate limits...`);
    await new Promise(resolve => setTimeout(resolve, staggerMs));

    if (!task.ocr) {
      task.ocr = {
        lastImageFile: null,
        lastImageUrl: null,
        lastPredictedText: null,
        status: 'idle',
        history: []
      };
    }

    try {
      page = await this.browser.newPage();
      
      console.log(`[Task ${task.id}] Navigating to voters list page...`);
      await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle', timeout: config.timeouts?.playwrightNav || 60000 });

      // Step 1: Select District
      await page.evaluate((val) => {
        const el = document.getElementById('view_voters_list_district');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, task.district.value);
      await page.waitForTimeout(2000);

      // Step 2: Select Local Body
      await page.evaluate((val) => {
        const el = document.getElementById('view_voters_list_localBody');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, task.localBody.value);
      await page.waitForTimeout(2000);

      // Step 3: Select Ward
      await page.evaluate((val) => {
        const el = document.getElementById('view_voters_list_ward');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, task.ward.value);
      await page.waitForTimeout(2000);

      // Step 4: Select Polling Station
      await page.evaluate((val) => {
        const el = document.getElementById('view_voters_list_pollingStation');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, task.pollingStation.value);
      await page.waitForTimeout(1000);

      // Step 5: Select Language
      await page.evaluate((val) => {
        const el = document.getElementById('view_voters_list_language');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, task.language.value);
      await page.waitForTimeout(1000);

      let success = false;
      let forceManualNext = false; // Flag to require manual solve on retry if OCR failed

      while (!success) {
        // Step 6: Locate and Screenshot Captcha
        const captchaLocator = page.locator('img[src*="generate-captcha"]');
        await captchaLocator.waitFor({ state: 'visible', timeout: 10000 });
        
        // Save captcha image with unique filename
        const imageFileName = `task_${task.id}_${Date.now()}.png`;
        const imageFilePath = path.join(captchasDir, imageFileName);
        await captchaLocator.screenshot({ path: imageFilePath });

        const captchaBuffer = fs.readFileSync(imageFilePath);
        task.captchaImg = captchaBuffer.toString('base64');
        task.ocr.lastImageFile = imageFileName;
        task.ocr.lastImageUrl = `/captchas/${imageFileName}`;

        let solvedText = '';
        let isManualSubmission = false;

        // Try automatic OCR if manual is not strictly forced
        if (!forceManualNext) {
          console.log(`[Task ${task.id}] Running EasyOCR on ${imageFileName}...`);
          task.status = 'ocr_solving';
          task.ocr.status = 'ocr_running';

          const predicted = await ocrService.solve(imageFilePath);
          console.log(`[Task ${task.id}] EasyOCR prediction: "${predicted}"`);
          task.ocr.lastPredictedText = predicted;

          if (predicted && predicted.length >= 4) {
            solvedText = predicted;
            task.status = 'submitting';
            console.log(`[Task ${task.id}] Auto-submitting with OCR: "${solvedText}"...`);
          } else {
            console.log(`[Task ${task.id}] OCR prediction uncertain ("${predicted}"). Falling back to manual verification.`);
            task.error = `OCR uncertain ("${predicted || 'empty'}"). Please solve manually.`;
            task.ocr.status = 'failed_auto';
            task.ocr.history.push({
              imageFile: imageFileName,
              predictedText: predicted || '',
              status: 'ocr_uncertain',
              timestamp: new Date().toISOString()
            });
            isManualSubmission = true;
          }
        } else {
          isManualSubmission = true;
        }

        // Fallback to manual solving queue if needed
        if (isManualSubmission) {
          task.status = 'awaiting_captcha';
          console.log(`[Task ${task.id}] Awaiting manual captcha input...`);

          solvedText = await new Promise((resolve) => {
            solveResolvers.set(task.id, resolve);
          });

          task.status = 'submitting';
          task.ocr.status = 'manual_input';
          task.error = null;
        }

        // Step 8: Enter Captcha and Submit
        await page.fill('#view_voters_list_captcha', solvedText);
        console.log(`[Task ${task.id}] Submitting form with text: ${solvedText}...`);
        await page.click('button.btn-pgfsv3');

        // Check for captcha error on page
        await page.waitForTimeout(2000);
        const errorMsg = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert, .invalid-feedback, .error, span[style*="red"]'));
          return alerts.map(a => a.textContent.trim()).filter(Boolean).join(' ');
        });

        if (errorMsg.toLowerCase().includes('try again') || errorMsg.toLowerCase().includes('invalid')) {
          console.log(`[Task ${task.id}] Submission rejected with text "${solvedText}".`);

          task.ocr.history.push({
            imageFile: imageFileName,
            submittedText: solvedText,
            isManual: isManualSubmission,
            status: 'rejected',
            timestamp: new Date().toISOString()
          });

          if (!isManualSubmission) {
            // OCR was wrong -> Switch to manual mode for the next captcha attempt!
            task.error = `OCR predicted "${solvedText}" (rejected). Please solve manually:`;
            task.ocr.status = 'failed_auto';
            forceManualNext = true;
          } else {
            task.error = "Incorrect captcha. Please try again.";
            forceManualNext = true;
          }

          task.status = 'awaiting_captcha';
          continue;
        }

        // Wait for search result container
        console.log(`[Task ${task.id}] Form submitted, waiting for results area...`);
        const resultLoaded = await page.waitForFunction(() => {
          const el = document.querySelector('.voters_list_search_result');
          return el && el.innerHTML.trim() !== '';
        }, { timeout: 25000 }).catch(() => null);

        if (!resultLoaded) {
          throw new Error("Results failed to load or empty output.");
        }

        // Log successful solve in task history
        task.ocr.history.push({
          imageFile: imageFileName,
          submittedText: solvedText,
          isManual: isManualSubmission,
          status: isManualSubmission ? 'manual_success' : 'auto_success',
          timestamp: new Date().toISOString()
        });
        task.ocr.status = isManualSubmission ? 'manual_success' : 'auto_success';

        // Step 9: Extract HTML table elements and parse them
        console.log(`[Task ${task.id}] Extracting table data...`);
        let tableData = await page.evaluate(() => {
          const tables = Array.from(document.querySelectorAll('.voters_list_search_result table'));
          if (tables.length === 0) return null;
          const rows = [];
          tables.forEach(table => {
            const trs = Array.from(table.querySelectorAll('tr'));
            trs.forEach(tr => {
              const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent.trim().replace(/\s+/g, ' '));
              if (cells.length > 0) rows.push(cells);
            });
          });
          return rows;
        });

        tableData = formatVotersTable(tableData);

        const fileName = getExpectedFilename(task);
        const savePath = path.join(downloadsDir, fileName);

        console.log(`[Task ${task.id}] Formatting and saving to Excel: ${fileName}...`);
        
        if (tableData && tableData.length > 0) {
          const ws = XLSX.utils.aoa_to_sheet(tableData);
          applyColWidths(ws, tableData);
          
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Voters List");
          XLSX.writeFile(wb, savePath);
        } else {
          const rawText = await page.innerText('.voters_list_search_result');
          const ws = XLSX.utils.aoa_to_sheet([[rawText]]);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Raw Data");
          XLSX.writeFile(wb, savePath);
        }

        task.fileName = fileName;
        task.status = 'completed';
        task.downloadedAt = new Date().toISOString();
        task.captchaImg = null;
        success = true;
      }

    } catch (err) {
      console.error(`[Task ${task.id}] Worker Error:`, err.message);
      task.status = 'failed';
      task.error = err.message;
    } finally {
      if (page) {
        await page.close().catch(() => null);
      }
      this.activeWorkers--;
      this.startWorkers();
    }
  }

  retryTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task && (task.status === 'failed' || task.status === 'completed')) {
      task.status = 'queued';
      task.captchaImg = null;
      task.error = null;
      task.fileName = null;
      this.startWorkers();
      return true;
    }
    return false;
  }
}

const pool = new ScraperPool(config.concurrencyLimit || 5);
pool.init();

// --------------------------------------------------------
// API Endpoints
// --------------------------------------------------------
app.get('/api/tasks', (req, res) => {
  res.json(tasks.map(t => ({
    id: t.id,
    wardText: t.ward.text,
    pollingStationText: t.pollingStation.text,
    status: t.status,
    hasCaptcha: !!t.captchaImg,
    error: t.error,
    fileName: t.fileName,
    downloadedAt: t.downloadedAt,
    ocr: t.ocr || null
  })));
});

app.get('/api/task-ocr/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (task && task.ocr) {
    res.json({
      taskId: task.id,
      wardText: task.ward.text,
      pollingStationText: task.pollingStation.text,
      status: task.status,
      ocr: task.ocr
    });
  } else {
    res.status(404).json({ error: "Task or OCR details not found." });
  }
});

app.get('/api/captcha/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (task && task.captchaImg) {
    const imgBuffer = Buffer.from(task.captchaImg, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': imgBuffer.length
    });
    res.end(imgBuffer);
  } else {
    res.status(404).json({ error: "Captcha not found or task not ready." });
  }
});

app.post('/api/solve', (req, res) => {
  const { id, captcha } = req.body;
  const taskId = parseInt(id);
  const resolver = solveResolvers.get(taskId);
  
  if (resolver && captcha) {
    solveResolvers.delete(taskId);
    resolver(captcha);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Invalid task ID or missing captcha text." });
  }
});

app.post('/api/retry/:id', (req, res) => {
  const success = pool.retryTask(parseInt(req.params.id));
  if (success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Cannot retry task in current state." });
  }
});

app.post('/api/retry-all-failed', (req, res) => {
  let count = 0;
  tasks.forEach(t => {
    if (t.status === 'failed') {
      t.status = 'queued';
      t.captchaImg = null;
      t.error = null;
      count++;
    }
  });
  if (count > 0) {
    pool.startWorkers();
  }
  res.json({ success: true, retriedCount: count });
});

// Compile tree map with downloaded and active statuses
app.get('/api/tree', (req, res) => {
  const existingDownloads = getExistingDownloads();
  const tree = {};

  rawCombinations.forEach(c => {
    const distText = c.district.text;
    const lbText = c.localBody.text;
    const wardText = c.ward.text;
    const psText = c.pollingStation.text;

    if (!tree[distText]) tree[distText] = {};
    if (!tree[distText][lbText]) tree[distText][lbText] = {};
    if (!tree[distText][lbText][wardText]) tree[distText][lbText][wardText] = [];

    const expectedFile = getExpectedFilename(c);
    const isDownloaded = existingDownloads.has(expectedFile);
    const activeTask = tasks.find(t => t.ward.value === c.ward.value && t.pollingStation.value === c.pollingStation.value);

    let status = 'idle';
    if (isDownloaded) {
      status = 'downloaded';
    } else if (activeTask) {
      status = activeTask.status;
    }

    tree[distText][lbText][wardText].push({
      pollingStationValue: c.pollingStation.value,
      pollingStationText: psText,
      wardValue: c.ward.value,
      wardText: wardText,
      localBodyValue: c.localBody.value,
      localBodyText: lbText,
      districtValue: c.district.value,
      districtText: distText,
      status: status,
      fileName: isDownloaded ? expectedFile : (activeTask ? activeTask.fileName : null)
    });
  });

  res.json(tree);
});

app.post('/api/stop-all', (req, res) => {
  tasks.forEach(t => {
    if (t.status === 'awaiting_captcha') {
      const resolver = solveResolvers.get(t.id);
      if (resolver) {
        resolver('');
        solveResolvers.delete(t.id);
      }
    }
  });
  tasks = tasks.filter(t => t.status !== 'queued' && t.status !== 'awaiting_captcha');
  res.json({ success: true, remaining: tasks.length });
});

// Queue selected items dynamically
app.post('/api/queue-items', (req, res) => {
  const { items } = req.body;
  let addedCount = 0;

  const existingKeys = new Set(tasks.map(t => `${t.ward.value}_${t.pollingStation.value}`));

  items.forEach(item => {
    const key = `${item.wardValue}_${item.pollingStationValue}`;
    if (!existingKeys.has(key)) {
      const c = rawCombinations.find(raw => raw.ward.value === item.wardValue && raw.pollingStation.value === item.pollingStationValue);
      if (c) {
        tasks.push({
          id: tasks.length + 1,
          district: c.district,
          localBody: c.localBody,
          ward: c.ward,
          pollingStation: c.pollingStation,
          language: c.language,
          status: 'queued',
          captchaImg: null,
          error: null,
          fileName: null,
          downloadedAt: null,
          ocr: {
            lastImageFile: null,
            lastImageUrl: null,
            lastPredictedText: null,
            status: 'idle',
            history: []
          }
        });
        addedCount++;
      }
    }
  });

  if (addedCount > 0) {
    pool.concurrencyLimit = tasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'awaiting_captcha' || t.status === 'ocr_solving').length > 1 ? (config.concurrencyLimit || 5) : 1;
    pool.startWorkers();
  }

  res.json({ success: true, addedCount });
});

app.post('/api/queue-all', (req, res) => {
  const existingKeys = new Set(tasks.map(t => `${t.ward.value}_${t.pollingStation.value}`));
  let addedCount = 0;
  rawCombinations.forEach(c => {
    const key = `${c.ward.value}_${c.pollingStation.value}`;
    if (!existingKeys.has(key)) {
      tasks.push({
        id: tasks.length + 1,
        district: c.district,
        localBody: c.localBody,
        ward: c.ward,
        pollingStation: c.pollingStation,
        language: c.language,
        status: 'queued',
        captchaImg: null,
        error: null,
        fileName: null,
        downloadedAt: null,
        ocr: {
          lastImageFile: null,
          lastImageUrl: null,
          lastPredictedText: null,
          status: 'idle',
          history: []
        }
      });
      addedCount++;
    }
  });

  if (addedCount > 0) {
    pool.concurrencyLimit = config.concurrencyLimit || 5;
    pool.startWorkers();
  }

  res.json({ success: true, addedCount });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Scraper Server running at http://localhost:${PORT}`);
  console.log(`📂 Downloads folder: ${downloadsDir}`);
  console.log(`🖼️ Captchas folder: ${captchasDir}`);
  console.log(`======================================================\n`);
});
