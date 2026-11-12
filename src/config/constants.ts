import type { SelectOption, TaskStatus, OcrStatus } from '../types/index.js';

export const SEC_BASE_URL = 'https://sec.kerala.gov.in';

export const SEC_URLS = {
  VOTERS_LIST: `${SEC_BASE_URL}/public/voters/list`,
  LOCAL_BODIES_BY_DISTRICT: `${SEC_BASE_URL}/public/getalllbcmp/byd`,
  WARDS_BY_LOCAL_BODY: `${SEC_BASE_URL}/public/getwardSbox`,
  POLLING_STATIONS_BY_WARD: `${SEC_BASE_URL}/public/getps/byward`,
} as const;

export const SEC_SELECTORS = {
  DISTRICT_SELECT: '#view_voters_list_district',
  LOCAL_BODY_SELECT: '#view_voters_list_localBody',
  WARD_SELECT: '#view_voters_list_ward',
  POLLING_STATION_SELECT: '#view_voters_list_pollingStation',
  LANGUAGE_SELECT: '#view_voters_list_language',
  CAPTCHA_IMG: 'img[src*="generate-captcha"]',
  CAPTCHA_INPUT: '#view_voters_list_captcha',
  SUBMIT_BUTTON: 'button.btn-pgfsv3',
  ERROR_ALERTS: '.alert, .invalid-feedback, .error, span[style*="red"]',
  RESULT_CONTAINER: '.voters_list_search_result',
  RESULT_TABLES: '.voters_list_search_result table',
} as const;

export const SUPPORTED_LANGUAGES: Record<string, SelectOption> = {
  E: { value: 'E', text: 'English' },
  M: { value: 'M', text: 'Malayalam' },
};

export const DEFAULT_LANGUAGE: SelectOption = SUPPORTED_LANGUAGES.E!;

export const COMBINED_OUTPUT_FILENAME = 'Combined_Voters_List.xlsx';

export const EXCEL_CONFIG = {
  VOTERS_SHEET_NAME: 'Voters List',
  RAW_SHEET_NAME: 'Raw Data',
  COMBINED_SHEET_NAME: 'Combined Voters',
  MIN_COL_WIDTH: 8,
  MAX_COL_WIDTH: 40,
  COL_PADDING: 3,
  DEFAULT_COL_WIDTH: 10,
} as const;

export const TASK_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  OCR_SOLVING: 'ocr_solving',
  AWAITING_CAPTCHA: 'awaiting_captcha',
  SUBMITTING: 'submitting',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const satisfies Record<string, TaskStatus>;

export const OCR_STATUS = {
  IDLE: 'idle',
  OCR_RUNNING: 'ocr_running',
  FAILED_AUTO: 'failed_auto',
  MANUAL_INPUT: 'manual_input',
  AUTO_SUCCESS: 'auto_success',
  MANUAL_SUCCESS: 'manual_success',
} as const satisfies Record<string, OcrStatus>;

/**
 * Playwright resource types aborted during scraping to reduce bandwidth and speed up page loads.
 * Images are kept enabled so captcha images load normally.
 */
export const BLOCKED_RESOURCE_TYPES = new Set(['stylesheet', 'font', 'media']);

export const CAPTCHA_ERROR_KEYWORDS = ['try again', 'invalid'] as const;

export const DROPDOWN_SETTLE_DELAY_MS = 300;
export const DROPDOWN_POLL_TIMEOUT_MS = 10000;
export const POST_SUBMIT_CHECK_DELAY_MS = 2000;
