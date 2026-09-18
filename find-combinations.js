import { chromium } from 'playwright';
import fs from 'fs';

async function run() {
  console.log("Launching browser to find all combinations of Ward and Polling Station...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle', timeout: 60000 });

  // Select Kozhikode (value 4)
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_district');
    el.value = '4';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);

  // Select Balussery (value K6zLwAVBRV)
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_localBody');
    el.value = 'K6zLwAVBRV';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);

  // Get all wards
  const wards = await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_ward');
    if (!el) return [];
    return Array.from(el.options)
      .filter(opt => opt.value !== '')
      .map(opt => ({
        value: opt.value,
        text: opt.textContent.trim()
      }));
  });

  console.log(`Found ${wards.length} wards. Extracting polling stations for each ward...`);

  const combinations = [];

  for (let i = 0; i < wards.length; i++) {
    const ward = wards[i];
    console.log(`Processing Ward ${i + 1}/${wards.length}: ${ward.text} (${ward.value})`);

    // Select ward
    await page.evaluate((val) => {
      const el = document.getElementById('view_voters_list_ward');
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, ward.value);

    // Wait for AJAX load
    await page.waitForTimeout(2000);

    // Get polling stations
    const pollingStations = await page.evaluate(() => {
      const el = document.getElementById('view_voters_list_pollingStation');
      if (!el) return [];
      return Array.from(el.options)
        .filter(opt => opt.value !== '')
        .map(opt => ({
          value: opt.value,
          text: opt.textContent.trim()
        }));
    });

    console.log(`-> Found ${pollingStations.length} polling stations.`);

    for (const ps of pollingStations) {
      combinations.push({
        district: { value: '4', text: 'KOZHIKODE' },
        localBody: { value: 'K6zLwAVBRV', text: 'G11035-Balussery' },
        ward: ward,
        pollingStation: ps,
        language: { value: 'E', text: 'English' }
      });
    }
  }

  // Save to file
  fs.writeFileSync('combinations.json', JSON.stringify(combinations, null, 2));
  console.log(`Saved ${combinations.length} combinations to combinations.json`);

  await browser.close();
}

run().catch(console.error);
