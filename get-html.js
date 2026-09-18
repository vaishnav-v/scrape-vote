import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle' });

  // Select District Kozhikode
  await page.evaluate(() => {
    document.getElementById('view_voters_list_district').value = '4';
    document.getElementById('view_voters_list_district').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  // Select Balussery
  await page.evaluate(() => {
    document.getElementById('view_voters_list_localBody').value = 'K6zLwAVBRV';
    document.getElementById('view_voters_list_localBody').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  // Select Ward 1
  await page.evaluate(() => {
    document.getElementById('view_voters_list_ward').value = 'ErLm8ogX7Y';
    document.getElementById('view_voters_list_ward').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  // Select Polling Station 1
  await page.evaluate(() => {
    document.getElementById('view_voters_list_pollingStation').value = '14XooVpXJr';
    document.getElementById('view_voters_list_pollingStation').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  // Select English
  await page.evaluate(() => {
    document.getElementById('view_voters_list_language').value = 'E';
    document.getElementById('view_voters_list_language').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  // Get outer HTML of the captcha input container
  const htmlInfo = await page.evaluate(() => {
    const capInput = document.getElementById('view_voters_list_captcha');
    if (!capInput) return "No captcha input found";
    
    // Let's traverse up to find the form or container
    let parent = capInput.parentElement;
    let details = [];
    while (parent && parent.tagName !== 'BODY') {
      details.push({
        tagName: parent.tagName,
        id: parent.id,
        className: parent.className,
        htmlSnippet: parent.outerHTML.substring(0, 300)
      });
      parent = parent.parentElement;
    }
    return details;
  });

  console.log("HTML Container Hierarchy for Captcha Input:");
  console.log(JSON.stringify(htmlInfo, null, 2));

  // Let's also check if there is a main form button we should click
  const buttonsInForm = await page.evaluate(() => {
    const mainForm = document.querySelector('form');
    if (!mainForm) return "No form found";
    return Array.from(mainForm.querySelectorAll('button, input[type="submit"], input[type="button"]')).map(btn => ({
      tagName: btn.tagName,
      id: btn.id,
      className: btn.className,
      type: btn.type,
      text: btn.textContent.trim() || btn.value
    }));
  });

  console.log("Buttons in Main Form:");
  console.log(JSON.stringify(buttonsInForm, null, 2));

  await browser.close();
}

run().catch(console.error);
