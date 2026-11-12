import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { COMBINED_OUTPUT_FILENAME, EXCEL_CONFIG } from '../config/constants.js';
import { logger } from './logger.service.js';
import type { Combination } from '../types/index.js';

export type FilenameCombination = Pick<
  Combination,
  'district' | 'localBody' | 'ward' | 'pollingStation'
>;

export function getExpectedFilename(c: FilenameCombination): string {
  const parts = [
    c.district.text,
    c.localBody.text,
    c.ward.text,
    c.pollingStation.text,
  ];
  const cleanParts = parts.map((p) =>
    p.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_'),
  );
  return `${cleanParts.join('_')}.xlsx`;
}

export function getExistingDownloads(downloadsDir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(downloadsDir));
  } catch {
    return new Set();
  }
}

export function formatVotersTable(tableData: string[][] | null): string[][] | null {
  if (!tableData || tableData.length === 0) return tableData;

  const header = tableData[0];
  if (!header) return tableData;

  let ageGenderIndex = -1;

  for (let i = 0; i < header.length; i++) {
    const colName = (header[i] ?? '').toLowerCase();
    if (
      colName.includes('age') &&
      (colName.includes('gender') ||
        colName.includes('sex') ||
        colName.includes('m/f') ||
        colName.includes('male/female') ||
        colName.includes('f/m'))
    ) {
      ageGenderIndex = i;
      break;
    }
  }

  const firstDataRow = tableData[1];
  if (ageGenderIndex === -1 && firstDataRow) {
    for (let col = 0; col < firstDataRow.length; col++) {
      const val = String(firstDataRow[col] ?? '');
      const lower = val.toLowerCase();
      if (
        val.includes('/') &&
        (lower.includes('m') ||
          lower.includes('f') ||
          lower.includes('male') ||
          lower.includes('female'))
      ) {
        ageGenderIndex = col;
        break;
      }
    }
  }

  if (ageGenderIndex === -1) {
    return tableData;
  }

  const formattedData: string[][] = [];
  const newHeader = [...header];
  newHeader.splice(ageGenderIndex, 1, 'Age', 'Gender');
  formattedData.push(newHeader);

  for (let r = 1; r < tableData.length; r++) {
    const sourceRow = tableData[r];
    if (!sourceRow) continue;

    const row = [...sourceRow];
    const combinedVal = String(row[ageGenderIndex] ?? '');

    let age = '';
    let gender = '';

    if (combinedVal.includes('/')) {
      const parts = combinedVal.split('/');
      age = (parts[0] ?? '').trim();
      gender = (parts[1] ?? '').trim();
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

export function applyColWidths(ws: XLSX.WorkSheet, data: unknown[][]): void {
  const firstRow = data[0];
  if (!firstRow || firstRow.length === 0) return;

  const colWidths: number[] = firstRow.map(() => EXCEL_CONFIG.DEFAULT_COL_WIDTH);

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;

    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] ?? '');
      const currentWidth = colWidths[c] ?? EXCEL_CONFIG.DEFAULT_COL_WIDTH;
      if (val.length > currentWidth) {
        colWidths[c] = val.length;
      }
    }
  }

  ws['!cols'] = colWidths.map((w) => ({
    wch: Math.min(
      Math.max(w + EXCEL_CONFIG.COL_PADDING, EXCEL_CONFIG.MIN_COL_WIDTH),
      EXCEL_CONFIG.MAX_COL_WIDTH,
    ),
  }));
}

export function saveVoterExcel(
  savePath: string,
  tableData: string[][] | null,
  rawTextFallback = '',
): void {
  const wb = XLSX.utils.book_new();

  if (tableData && tableData.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet(tableData);
    applyColWidths(ws, tableData);
    XLSX.utils.book_append_sheet(wb, ws, EXCEL_CONFIG.VOTERS_SHEET_NAME);
  } else {
    const ws = XLSX.utils.aoa_to_sheet([[rawTextFallback]]);
    XLSX.utils.book_append_sheet(wb, ws, EXCEL_CONFIG.RAW_SHEET_NAME);
  }

  XLSX.writeFile(wb, savePath);
}

export interface CombineOptions {
  combinationsFile: string;
  downloadsDir: string;
  outputFile?: string;
}

export interface CombineResult {
  combinedFiles: number;
  skippedFiles: number;
  totalRecords: number;
  outputFile: string;
}

export function combineDownloadedWorkbooks(options: CombineOptions): CombineResult {
  const { combinationsFile, downloadsDir } = options;
  const outputFile =
    options.outputFile ?? path.join(downloadsDir, COMBINED_OUTPUT_FILENAME);
  const outputBasename = path.basename(outputFile);

  if (!fs.existsSync(combinationsFile)) {
    throw new Error(
      `Combinations file not found at "${combinationsFile}". Run fetch-combinations first.`,
    );
  }

  if (!fs.existsSync(downloadsDir)) {
    throw new Error(`Downloads directory not found at "${downloadsDir}".`);
  }

  const combinations = JSON.parse(
    fs.readFileSync(combinationsFile, 'utf8'),
  ) as Combination[];

  const fileToCombination = new Map<string, Combination>();
  for (const combo of combinations) {
    fileToCombination.set(getExpectedFilename(combo), combo);
  }

  const files = fs
    .readdirSync(downloadsDir)
    .filter((f) => f.endsWith('.xlsx') && f !== outputBasename);

  if (files.length === 0) {
    return {
      combinedFiles: 0,
      skippedFiles: 0,
      totalRecords: 0,
      outputFile,
    };
  }

  const combinedData: unknown[][] = [];
  let headerWritten = false;
  let combinedFiles = 0;
  let skippedFiles = 0;

  for (const file of files) {
    const combo = fileToCombination.get(file);
    if (!combo) {
      logger.warn(`Skipping "${file}" (no matching entry in combinations.json).`);
      skippedFiles++;
      continue;
    }

    const filePath = path.join(downloadsDir, file);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      skippedFiles++;
      continue;
    }

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      skippedFiles++;
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
    if (rows.length === 0) {
      skippedFiles++;
      continue;
    }

    const originalHeader = rows[0] ?? [];
    const dataRows = rows.slice(1);

    const wardText = combo.ward.text;
    let wardNum = '';
    let wardName = wardText;
    const wardMatch = wardText.match(/^(\d+)\s*-\s*(.*)$/);
    if (wardMatch) {
      wardNum = (wardMatch[1] ?? '').trim();
      wardName = (wardMatch[2] ?? '').trim();
    }

    if (!headerWritten) {
      combinedData.push([
        'District',
        'Local Body',
        'Ward Number',
        'Ward Name',
        'Polling Station',
        ...originalHeader,
      ]);
      headerWritten = true;
    }

    for (const row of dataRows) {
      combinedData.push([
        combo.district.text,
        combo.localBody.text,
        wardNum,
        wardName,
        combo.pollingStation.text,
        ...row,
      ]);
    }
    combinedFiles++;
  }

  if (combinedData.length <= 1) {
    return {
      combinedFiles,
      skippedFiles,
      totalRecords: 0,
      outputFile,
    };
  }

  const ws = XLSX.utils.aoa_to_sheet(combinedData);
  applyColWidths(ws, combinedData);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, EXCEL_CONFIG.COMBINED_SHEET_NAME);

  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
  }

  XLSX.writeFile(wb, outputFile);

  return {
    combinedFiles,
    skippedFiles,
    totalRecords: combinedData.length - 1,
    outputFile,
  };
}

