# Architecture

## High-Level Flow

1. **Discovery (`src/cli/fetch-combinations.ts`):**
   - Scrapes available districts from `https://sec.kerala.gov.in/public/voters/list`.
   - Queries `/public/getalllbcmp/byd`, `/public/getwardSbox`, and `/public/getps/byward` concurrently with retries and deduplication to produce `combinations.json`.
2. **Task Queue & Browser Pool (`src/services/scraper.service.ts`):**
   - `ScraperPool` maintains up to `CONCURRENCY_LIMIT` concurrent Playwright workers, each running in an isolated `BrowserContext`.
   - Workers select District → Local Body → Ward → Polling Station → Language by polling dependent dropdowns, then capture the captcha image.
   - Task metadata is periodically checkpointed to `tasks-state.json` via `src/services/state.service.ts`.
3. **OCR Pipe + Manual Fallback (`src/services/ocr.service.ts`):**
   - Spawns a persistent `python/solve_easyocr.py --pipe` process so EasyOCR weights stay cached in RAM.
   - Jobs are processed strictly sequentially over newline-delimited JSON on `stdin`/`stdout`.
   - When `{"status": "ready"}` arrives, `OcrService` drains any jobs queued during model warm-up.
   - If a job times out on the pipe, the worker process is killed (`SIGKILL`) and retried once via CLI fallback (`solve_easyocr.py <image>`).
   - If the prediction is shorter than `OCR_MIN_TEXT_LENGTH` or rejected by the portal, the task transitions to `awaiting_captcha` for manual resolution in the web UI (`POST /api/solve`).
4. **Excel Formatting & Merging (`src/services/excel.service.ts`):**
   - Extracts HTML tables from `.voters_list_search_result table`, splits combined `Age/Gender` columns into separate `Age` and `Gender` columns, auto-sizes column widths, and writes `.xlsx` files to `DOWNLOADS_DIR`.
   - `combineDownloadedWorkbooks` enriches each row with `District`, `Local Body`, `Ward Number`, `Ward Name`, and `Polling Station`, producing `Combined_Voters_List.xlsx`.

## HTTP API Endpoints (`src/routes/api.routes.ts`)

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Service health, OCR readiness, and queue counts |
| `GET` | `/api/tree` | District → Local Body → Ward → Polling Station tree with download status |
| `GET` | `/api/tasks` | Summary list of all queued/active/completed/failed tasks |
| `GET` | `/api/task-ocr/:id` | Detailed OCR attempt history for a task |
| `GET` | `/api/captcha/:id` | Current captcha PNG for a task |
| `POST` | `/api/solve` | Submit manual captcha text (`{ id, captcha }`) |
| `POST` | `/api/queue-items` | Queue specific `{ wardValue, pollingStationValue }` items |
| `POST` | `/api/queue-all` | Queue all remaining combinations |
| `POST` | `/api/retry/:id` | Retry a single failed or completed task |
| `POST` | `/api/retry-all-failed` | Re-queue all failed tasks |
| `POST` | `/api/stop-all` | Cancel queued and awaiting-captcha tasks |
| `POST` | `/api/combine` | Merge downloaded `.xlsx` files into `Combined_Voters_List.xlsx` |

