# Kerala SEC Voter List Scraper

A scalable TypeScript + Playwright + EasyOCR tool with a live web dashboard for fetching, solving captchas, and exporting public voter list tables from the Kerala State Election Commission (`sec.kerala.gov.in`) into structured Excel (`.xlsx`) workbooks.

## Features

- **District-Wide Combinations Crawler (`fetch-combinations`):** Fetches districts, local bodies, wards, and polling stations concurrently with retries and optional filtering (`--district`, `--local-body`, `--language`).
- **Concurrent Playwright Worker Pool:** Runs isolated `BrowserContext` workers with configurable concurrency, request asset blocking, automatic retries, and periodic browser recycling.
- **Persistent EasyOCR Pipe + Manual Fallback:** Keeps an EasyOCR worker warm in memory over stdin/stdout JSON lines (supports native Python, Windows WSL, or Docker), automatically falling back to the web UI for uncertain or rejected captchas.
- **State Persistence:** Saves task progress to `tasks-state.json` so interrupted runs resume cleanly after restarts.
- **Excel Formatting & Merger:** Automatically splits combined `Age / Gender` columns into separate columns, auto-fits column widths, and merges individual polling-station workbooks into `Combined_Voters_List.xlsx`.
- **Docker Ready:** Multi-stage `Dockerfile` and `docker-compose.yml` bundling Node.js, Playwright Chromium, and Python EasyOCR.

## Quick Start

### Option A: Docker (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Generate `combinations.json` inside the shared `./data` volume (example: Kozhikode district `4`, or omit `--district` for all districts):
   ```bash
   docker compose run --rm scraper node dist/cli/fetch-combinations.js --district 4
   ```
3. Start the web dashboard and scraper server:
   ```bash
   docker compose up -d --build
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.
5. Merge downloaded Excel files into one workbook:
   ```bash
   docker compose run --rm scraper node dist/cli/combine-excel.js
   ```

### Option B: Local Development (Node.js + Python)

1. **Install Node.js dependencies and Chromium:**
   ```bash
   npm install
   npx playwright install chromium
   ```
2. **Install Python EasyOCR dependencies:**
   ```bash
   python3 -m pip install -r python/requirements.txt
   ```
   *(If running on Windows with EasyOCR installed inside WSL, set `OCR_USE_WSL=true` in `.env`.)*
3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
4. **Fetch polling station combinations:**
   ```bash
   # Interactive mode: fetches all districts + IDs and lets you select from the prompt
   npm run fetch-combinations

   # List all district names & IDs
   npm run fetch-combinations -- --list-districts

   # Non-interactive / filtered by district ID or name
   npm run fetch-combinations -- --district 4
   npm run fetch-combinations -- --district KOZHIKODE --language E
   ```
5. **Start the server:**
   ```bash
   # Development (hot-reload)
   npm run dev

   # Production build
   npm run build
   npm start
   ```
6. **Combine exported Excel files:**
   ```bash
   npm run combine
   ```

## Project Structure

```text
src/
  config/         # Validated .env config (Zod) & SEC portal constants/selectors
  types/          # Shared TypeScript interfaces
  services/       # OcrService, ScraperPool, Excel formatting/merging, Logger, State
  routes/         # Express /api/* endpoints
  cli/            # fetch-combinations & combine-excel CLI tools
  server.ts       # Express server bootstrap & graceful shutdown
python/
  solve_easyocr.py
  requirements.txt
public/
  index.html      # Live tree browser, captcha solver UI & OCR inspector
docs/
  SETUP.md
  CONFIGURATION.md
  ARCHITECTURE.md
```

## Documentation

- [Setup Guide (Local, WSL & Docker)](docs/SETUP.md)
- [Configuration & Environment Variables](docs/CONFIGURATION.md)
- [Architecture & OCR Pipe Protocol](docs/ARCHITECTURE.md)
- [Contributing Guidelines](CONTRIBUTING.md)

## Disclaimer

This project is intended for educational, civic-research, and archival workflows on publicly accessible electoral roll listings. Always respect the target portal's rate limits and applicable local laws.

## License

[MIT](LICENSE)

