import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = path.join(__dirname, 'downloads');
const combinationsFile = path.join(__dirname, 'combinations.json');
const outputFile = path.join(downloadsDir, 'Combined_Voters_List.xlsx');

// Helper to get expected filename for matching combinations
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

async function run() {
  console.log("Starting Excel combination process...");

  if (!fs.existsSync(combinationsFile)) {
    console.error("Error: combinations.json not found! Please run the crawl step first.");
    process.exit(1);
  }

  // Load combinations map
  const combinations = JSON.parse(fs.readFileSync(combinationsFile, 'utf8'));
  const fileToConfigMap = new Map();
  combinations.forEach(c => {
    const expected = getExpectedFilename(c);
    fileToConfigMap.set(expected, c);
  });

  // Read files in downloads/ (ignoring the output file if it exists)
  if (!fs.existsSync(downloadsDir)) {
    console.error("Error: downloads folder not found!");
    process.exit(1);
  }

  const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.xlsx') && f !== 'Combined_Voters_List.xlsx');
  console.log(`Found ${files.length} individual Excel files to combine.`);

  if (files.length === 0) {
    console.log("No Excel files found to combine. Exiting.");
    return;
  }

  let combinedData = [];
  let headerWritten = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const config = fileToConfigMap.get(file);
    if (!config) {
      console.warn(`Warning: File "${file}" does not match any entry in combinations.json. Skipping.`);
      continue;
    }

    const filePath = path.join(downloadsDir, file);
    
    // Read individual workbook
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Parse worksheet rows
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (rows.length === 0) continue;

    const originalHeader = rows[0];
    const dataRows = rows.slice(1);

    // Extract Ward Number and Ward Name from "001 - KANHIKKAVE"
    const wardText = config.ward.text;
    let wardNum = '';
    let wardName = wardText;
    const wardMatch = wardText.match(/^(\d+)\s*-\s*(.*)$/);
    if (wardMatch) {
      wardNum = wardMatch[1].trim();
      wardName = wardMatch[2].trim();
    }

    // Write header once
    if (!headerWritten) {
      const combinedHeader = [
        "District",
        "Local Body",
        "Ward Number",
        "Ward Name",
        "Polling Station",
        ...originalHeader
      ];
      combinedData.push(combinedHeader);
      headerWritten = true;
    }

    // Append data rows with context
    dataRows.forEach(row => {
      const fullRow = [
        config.district.text,
        config.localBody.text,
        wardNum,
        wardName,
        config.pollingStation.text,
        ...row
      ];
      combinedData.push(fullRow);
    });
  }

  if (combinedData.length <= 1) {
    console.log("No voter rows parsed. Exiting.");
    return;
  }

  // Create combined worksheet
  const ws = XLSX.utils.aoa_to_sheet(combinedData);
  
  // Calculate column widths dynamically
  const colWidths = combinedData[0].map(() => 10);
  for (let r = 0; r < combinedData.length; r++) {
    for (let c = 0; c < combinedData[r].length; c++) {
      const val = String(combinedData[r][c] || '');
      if (val.length > colWidths[c]) {
        colWidths[c] = val.length;
      }
    }
  }
  ws['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w + 3, 8), 40) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Combined Voters");

  // Overwrite existing file
  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log("Removed existing Combined_Voters_List.xlsx");
  }

  XLSX.writeFile(wb, outputFile);

  console.log(`\n======================================================`);
  console.log(`🎉 Combined successfully!`);
  console.log(`Combined count: ${files.length} files`);
  console.log(`Total voter records: ${combinedData.length - 1}`);
  console.log(`Output: ${outputFile}`);
  console.log(`======================================================\n`);
}

run().catch(console.error);
