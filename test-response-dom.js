import { chromium } from 'playwright';

async function run() {
  console.log("Launching browser to inspect results area in the DOM...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle' });

  // Get DOM details of the results wrapper class (.voters_list_search_result)
  const resultsContainerHTML = await page.evaluate(() => {
    const el = document.querySelector('.voters_list_search_result');
    return el ? el.outerHTML : 'Not found';
  });

  console.log("--- RESULTS CONTAINER HTML ON LOAD ---");
  console.log(resultsContainerHTML);

  await browser.close();
}

run().catch(console.error);
