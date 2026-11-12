export interface SelectOption {
  value: string;
  text: string;
}

export interface Combination {
  district: SelectOption;
  localBody: SelectOption;
  ward: SelectOption;
  pollingStation: SelectOption;
  language: SelectOption;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'ocr_solving'
  | 'awaiting_captcha'
  | 'submitting'
  | 'completed'
  | 'failed';

export type OcrStatus =
  | 'idle'
  | 'ocr_running'
  | 'failed_auto'
  | 'manual_input'
  | 'auto_success'
  | 'manual_success';

export interface OcrAttempt {
  imageFile: string;
  predictedText?: string;
  submittedText?: string;
  isManual?: boolean;
  status: 'ocr_uncertain' | 'rejected' | 'auto_success' | 'manual_success';
  timestamp: string;
}

export interface OcrState {
  lastImageFile: string | null;
  lastImageUrl: string | null;
  lastPredictedText: string | null;
  status: OcrStatus;
  history: OcrAttempt[];
}

export interface ScrapeTask {
  id: number;
  district: SelectOption;
  localBody: SelectOption;
  ward: SelectOption;
  pollingStation: SelectOption;
  language: SelectOption;
  status: TaskStatus;
  captchaImg: string | null;
  error: string | null;
  fileName: string | null;
  downloadedAt: string | null;
  retries: number;
  ocr: OcrState;
}

export interface TaskSummaryDto {
  id: number;
  wardText: string;
  pollingStationText: string;
  status: TaskStatus;
  hasCaptcha: boolean;
  error: string | null;
  fileName: string | null;
  downloadedAt: string | null;
  ocr: OcrState | null;
}

export interface TreePollingStationNode {
  pollingStationValue: string;
  pollingStationText: string;
  wardValue: string;
  wardText: string;
  localBodyValue: string;
  localBodyText: string;
  districtValue: string;
  districtText: string;
  status: TaskStatus | 'idle' | 'downloaded';
  fileName: string | null;
}

export type TreeMap = Record<
  string,
  Record<string, Record<string, TreePollingStationNode[]>>
>;

export interface QueueItemInput {
  wardValue: string;
  pollingStationValue: string;
}

