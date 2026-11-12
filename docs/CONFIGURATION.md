# Configuration Reference

All runtime settings are loaded from environment variables (or `.env`) and validated at startup in `src/config/env.ts` using Zod. Portal URLs, DOM selectors, and fixed defaults live in `src/config/constants.ts`.

## Environment Variables (`.env`)

### Server
| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the Express server and dashboard UI |
| `HOST` | `0.0.0.0` | Network interface to bind |

### Worker Pool & Scaling
| Variable | Default | Description |
| --- | --- | --- |
| `CONCURRENCY_LIMIT` | `3` | Maximum concurrent Playwright worker tabs (`1`–`20`) |
| `STAGGER_MIN_MS` | `1000` | Minimum random delay before a worker starts navigating |
| `STAGGER_MAX_MS` | `3000` | Maximum random delay before a worker starts navigating |
| `MAX_TASK_RETRIES` | `2` | Automatic retry attempts on transient Playwright errors |
| `BROWSER_RECYCLE_AFTER` | `50` | Relaunch Chromium after this many completed tasks when idle (`0` disables) |

### Playwright Browser
| Variable | Default | Description |
| --- | --- | --- |
| `PLAYWRIGHT_HEADLESS` | `true` | Run Chromium headlessly (`false` opens visible browser windows) |
| `PLAYWRIGHT_NAV_TIMEOUT_MS` | `60000` | Navigation timeout for `sec.kerala.gov.in` |
| `RESULT_WAIT_TIMEOUT_MS` | `60000` | Timeout waiting for `.voters_list_search_result` to populate |
| `BLOCK_NON_ESSENTIAL_ASSETS` | `true` | Abort `stylesheet`, `font`, and `media` requests to speed up scraping |

### EasyOCR Captcha Solver
| Variable | Default | Description |
| --- | --- | --- |
| `OCR_ENABLED` | `true` | Enable EasyOCR auto-solving (`false` goes straight to manual UI solving) |
| `OCR_USE_WSL` | `false` | Run Python inside `wsl` and convert Windows paths to `/mnt/<drive>/...` |
| `PYTHON_BIN` | `python3` | Python executable path (`python3`, `python`, or path to a virtualenv binary) |
| `OCR_PIPE_TIMEOUT_MS` | `30000` | Timeout per captcha on the persistent stdin/stdout pipe |
| `OCR_CLI_TIMEOUT_MS` | `45000` | Timeout for one-off CLI fallback when the pipe hangs |
| `OCR_MIN_TEXT_LENGTH` | `4` | Minimum predicted string length required to auto-submit without manual review |
| `OCR_RECONNECT_DELAY_MS` | `3000` | Delay before restarting the persistent Python worker after exit |
| `SAVE_CAPTCHA_DATASET` | `true` | Keep solved captcha PNGs renamed as `<answer>_task_<id>_<ts>.png` |

### Storage Paths
| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `.` | Base directory for generated files (`/app/data` in Docker) |
| `DOWNLOADS_DIR` | `<DATA_DIR>/downloads` | Directory where polling-station `.xlsx` files are saved |
| `CAPTCHAS_DIR` | `<DATA_DIR>/captchas` | Directory for captured captcha screenshots |
| `LOGS_DIR` | `<DATA_DIR>/logs` | Directory for `scraper.log` and `scraper_error.log` |
| `COMBINATIONS_FILE` | `<DATA_DIR>/combinations.json` | Input list of district/local-body/ward/polling-station combinations |
| `STATE_FILE` | `<DATA_DIR>/tasks-state.json` | Persisted task queue & retry state |

### Combinations Crawler CLI (`fetch-combinations`)
| Variable | Default | Description |
| --- | --- | --- |
| `FETCH_CONCURRENCY` | `5` | Concurrent local-body requests while crawling combinations |
| `FETCH_DELAY_MS` | `200` | Polite delay between ward polling-station lookups |
| `FETCH_RETRIES` | `3` | Retry attempts per failed HTTP request with exponential backoff |

## CLI Flags for `fetch-combinations`

Running `npm run fetch-combinations` without `--district` in an interactive terminal loads all districts with their IDs from SEC Kerala and prompts you to select districts, local bodies (when 1 district is selected), and language.

```bash
npm run fetch-combinations -- --district 4 --local-body Balussery --language E --concurrency 5
```

- `--district <id|name>`: Filter by district ID or name (comma-separated or repeatable, or `all`).
- `--local-body <id|name>`: Filter local bodies by exact ID or name substring (comma-separated or repeatable).
- `--language <E|M>`: `E` for English (default) or `M` for Malayalam.
- `--list-districts`: Fetch and print all districts with their IDs, then exit.
- `--non-interactive`: Skip interactive prompts and use CLI flags/defaults (`all` districts, `E`).
- `--out <path>`: Custom output JSON file path.
- `--concurrency <n>`: Override `FETCH_CONCURRENCY`.

