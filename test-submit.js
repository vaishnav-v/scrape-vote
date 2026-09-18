import { chromium } from 'playwright';

async function run() {
  console.log("Launching browser to test form submission behavior...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Register dialog handler to capture alert popups
  page.on('dialog', async dialog => {
    console.log(`[DIALOG] Type: ${dialog.type()}, Message: "${dialog.message()}"`);
    await dialog.dismiss();
  });

  await page.goto('https://sec.kerala.gov.in/public/voters/list', { waitUntil: 'networkidle' });

  console.log("Selecting District (Kozhikode)...");
  await page.evaluate(() => {
    document.getElementById('view_voters_list_district').value = '4';
    document.getElementById('view_voters_list_district').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Local Body (Balussery)...");
  await page.evaluate(() => {
    document.getElementById('view_voters_list_localBody').value = 'K6zLwAVBRV';
    document.getElementById('view_voters_list_localBody').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Ward 1...");
  await page.evaluate(() => {
    document.getElementById('view_voters_list_ward').value = 'ErLm8ogX7Y';
    document.getElementById('view_voters_list_ward').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  console.log("Selecting Polling Station 1...");
  await page.evaluate(() => {
    document.getElementById('view_voters_list_pollingStation').value = '14XooVpXJr';
    document.getElementById('view_voters_list_pollingStation').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  console.log("Selecting Language (English)...");
  await page.evaluate(() => {
    document.getElementById('view_voters_list_language').value = 'E';
    document.getElementById('view_voters_list_language').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  // Fill wrong captcha
  console.log("Entering wrong captcha '12345'...");
  await page.fill('#view_voters_list_captcha', '12345');

  console.log("Clicking Search...");
  await page.click('button.btn-pgfsv3');

  // Wait to see what happens (alert, DOM update, or reload)
  console.log("Waiting for form submission response...");
  await page.waitForTimeout(4000);

  // Check if there are error messages in the DOM
  const errorText = await page.evaluate(() => {
    // Look for common error elements or alerts
    const alerts = Array.from(document.querySelectorAll('.alert, .invalid-feedback, .error, span[style*="red"]'));
    return alerts.map(a => a.textContent.trim()).filter(Boolean);
  });
  console.log("DOM Error texts found:", errorText);

  // Check if captcha loaded a new image URL
  const currentCaptchaSrc = await page.evaluate(() => {
    const img = document.querySelector('img[src*="captcha"]');
    return img ? img.src : null;
  });
  console.log("Current Captcha Src:", currentCaptchaSrc);

  await page.screenshot({ path: 'submit_test_screenshot.png' });
  console.log("Saved screenshot to submit_test_screenshot.png");

  await browser.close();
}

run().catch(console.error);
