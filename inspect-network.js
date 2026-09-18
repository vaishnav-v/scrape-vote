import { chromium } from 'playwright';

async function run() {
  console.log("Launching browser to inspect network requests...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Intercept all requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('sec.kerala.gov.in') && !url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
      console.log(`[REQUEST] ${request.method()} ${url}`);
      const postData = request.postData();
      if (postData) {
        console.log(`  POST Data: ${postData}`);
      }
    }
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('getall') || url.includes('getward') || url.includes('getpolling') || url.includes('byd') || url.includes('public/voters/list')) {
      if (!url.includes('.js') && !url.includes('.css')) {
        console.log(`[RESPONSE] ${response.status()} ${url}`);
        try {
          const text = await response.text();
          console.log(`  Response body (first 200 chars): ${text.substring(0, 200)}`);
        } catch (e) {
          console.log(`  Failed to read response body: ${e.message}`);
        }
      }
    }
  });

  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle' });

  // Select Kozhikode
  console.log("\nSelecting Kozhikode...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_district');
    el.value = '4';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(3000);

  // Select Balussery
  console.log("\nSelecting Balussery...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_localBody');
    el.value = 'K6zLwAVBRV';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(3000);

  // Select Ward 1
  console.log("\nSelecting Ward 1...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_ward');
    el.value = 'ErLm8ogX7Y';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(3000);

  await browser.close();
}

run().catch(console.error);
