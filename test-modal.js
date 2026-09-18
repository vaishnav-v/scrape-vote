import { chromium } from 'playwright';

async function run() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("Navigating to https://sec.kerala.gov.in/public/voters/list ...");
  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle' });

  // 1. Programmatically select the fields
  console.log("Selecting District (Kozhikode)...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_district');
    el.value = '4';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Local Body (Balussery)...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_localBody');
    el.value = 'K6zLwAVBRV';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Ward (001 - KANHIKKAVE)...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_ward');
    el.value = 'ErLm8ogX7Y';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Polling Station (001)...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_pollingStation');
    el.value = '14XooVpXJr';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  console.log("Selecting Language (English)...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_language');
    el.value = 'E';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  // Check if captcha is visible BEFORE search click
  const checkVisibility = async (stage) => {
    return await page.evaluate((stage) => {
      const captchaImg = document.querySelector('img[src*="captcha"]');
      const captchaInput = document.getElementById('view_voters_list_captcha');
      const okBtn = document.querySelector('button.selectCode');
      
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return !!(el.offsetWidth || el.offsetHeight || rect.width || rect.height) && window.getComputedStyle(el).display !== 'none';
      };

      return {
        stage,
        captchaImg: captchaImg ? {
          src: captchaImg.src,
          visible: isVisible(captchaImg)
        } : null,
        captchaInput: captchaInput ? {
          visible: isVisible(captchaInput)
        } : null,
        okButton: okBtn ? {
          visible: isVisible(okBtn)
        } : null
      };
    }, stage);
  };

  console.log("Checking visibility before search click...");
  console.log(JSON.stringify(await checkVisibility("Before Search"), null, 2));

  // Click Search
  console.log("Clicking the Search button...");
  await page.click('button.btn-pgfsv3');
  await page.waitForTimeout(2000);

  console.log("Checking visibility after search click...");
  console.log(JSON.stringify(await checkVisibility("After Search"), null, 2));

  // Take screenshot
  console.log("Taking screenshot...");
  await page.screenshot({ path: 'screenshot.png' });
  console.log("Screenshot saved to screenshot.png");

  await browser.close();
}

run().catch(console.error);
