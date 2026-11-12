import { env } from '../config/env.js';
import { combineDownloadedWorkbooks } from '../services/excel.service.js';

function run(): void {
  console.log('Starting Excel combination process...');
  const result = combineDownloadedWorkbooks({
    combinationsFile: env.combinationsFile,
    downloadsDir: env.downloadsDir,
  });

  if (result.combinedFiles === 0) {
    console.log('No matching Excel files found to combine.');
    return;
  }

  console.log('\n======================================================');
  console.log('Combined successfully!');
  console.log(`Combined files:       ${result.combinedFiles}`);
  console.log(`Skipped files:        ${result.skippedFiles}`);
  console.log(`Total voter records:  ${result.totalRecords}`);
  console.log(`Output file:          ${result.outputFile}`);
  console.log('======================================================\n');
}

try {
  run();
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}

