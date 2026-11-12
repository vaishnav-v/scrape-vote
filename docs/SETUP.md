# Setup Guide

## Prerequisites

- **Node.js** >= 20.0.0
- **Python** 3.10+ (only required when `OCR_ENABLED=true`)
- **Docker & Docker Compose** (optional, for containerized runs)

---

## 1. Local Setup (Linux / macOS / Windows Native Python)

1. Install Node packages and Playwright's Chromium binary:
   ```bash
   npm install
   npx playwright install chromium
   ```
   On Linux servers without a desktop environment, install Chromium OS dependencies as well:
   ```bash
   npx playwright install --with-deps chromium
   ```

2. Create a Python virtual environment and install EasyOCR:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate   # Windows PowerShell: .venv\Scripts\Activate.ps1
   pip install -r python/requirements.txt
   ```

3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   If using a virtual environment, set `PYTHON_BIN` in `.env` to your venv Python executable (for example `./.venv/bin/python` on Linux/macOS or `.venv\Scripts\python.exe` on Windows).

4. Generate `combinations.json`:
   ```bash
   npm run fetch-combinations -- --district 4
   ```

5. Build and run:
   ```bash
   npm run build
   npm start
   ```

---

## 2. Windows + WSL Setup

If you run Node.js on Windows while EasyOCR is installed inside WSL:

1. Install `easyocr` inside your WSL Ubuntu/Linux distro:
   ```bash
   pip3 install -r python/requirements.txt
   ```
2. Set the following in `.env`:
   ```env
   OCR_ENABLED=true
   OCR_USE_WSL=true
   PYTHON_BIN=python3
   ```
3. Start the server from Windows:
   ```powershell
   npm run dev
   ```
   `OcrService` automatically converts Windows paths (such as `D:\code\scrape-vote\...`) to `/mnt/d/...` when invoking `wsl`.

---

## 3. Docker Setup

The included `Dockerfile` uses a multi-stage build on `node:22-bookworm-slim`, installs Playwright Chromium with system libraries, and isolates EasyOCR inside `/opt/venv`.

1. Build and start in detached mode:
   ```bash
   docker compose up -d --build
   ```

2. Fetch combinations into the mounted `./data` directory (`/app/data/combinations.json` inside the container):
   ```bash
   # Crawl all districts
   docker compose run --rm scraper node dist/cli/fetch-combinations.js

   # Or crawl a single district (e.g. Kozhikode = 4)
   docker compose run --rm scraper node dist/cli/fetch-combinations.js --district 4
   ```
   Restart the running container so it loads the newly created `combinations.json`:
   ```bash
   docker compose restart scraper
   ```

3. Open [http://localhost:3000](http://localhost:3000) to queue polling stations and monitor progress.

4. Combine downloaded `.xlsx` files into `./data/downloads/Combined_Voters_List.xlsx`:
   ```bash
   docker compose run --rm scraper node dist/cli/combine-excel.js
   ```

> **Tip:** `docker-compose.yml` mounts a named volume `easyocr_models:/root/.EasyOCR` so EasyOCR weights are only downloaded once across container restarts.

