import { chromium } from 'playwright';

async function run() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("Navigating to https://sec.kerala.gov.in/public/voters/list ...");
  try {
    await page.goto('https://sec.kerala.gov.in/public/voters/list', { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });
    console.log("Page loaded successfully.");
  } catch (err) {
    console.error("Failed to load page:", err);
    await browser.close();
    process.exit(1);
  }
  
  // Select KOZHIKODE (value: "4") programmatically
  console.log("Selecting KOZHIKODE (value: '4') programmatically...");
  await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_district');
    if (el) {
      el.value = '4';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("Dispatched change event for district");
    } else {
      console.error("District select not found");
    }
  });

  console.log("Waiting 3 seconds for Local Body dropdown to load...");
  await page.waitForTimeout(3000);

  // Let's check the options in the Local Body dropdown
  const localBodyOptions = await page.evaluate(() => {
    const el = document.getElementById('view_voters_list_localBody');
    if (!el) return [];
    return Array.from(el.options).map(opt => ({
      value: opt.value,
      text: opt.textContent.trim()
    }));
  });

  console.log(`Found ${localBodyOptions.length} local bodies.`);
  // Log the ones containing Balussery
  const balusseryOpts = localBodyOptions.filter(o => o.text.toLowerCase().includes('balussery'));
  console.log("Balussery Options found:", balusseryOpts);

  if (balusseryOpts.length > 0) {
    const balOpt = balusseryOpts[0];
    console.log(`Selecting Balussery (value: '${balOpt.value}')...`);
    
    await page.evaluate((val) => {
      const el = document.getElementById('view_voters_list_localBody');
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, balOpt.value);

    console.log("Waiting 3 seconds for Wards to load...");
    await page.waitForTimeout(3000);

    // Select Ward 1 (value: 'ErLm8ogX7Y')
    console.log("Selecting Ward 1 (value: 'ErLm8ogX7Y')...");
    await page.evaluate(() => {
      const el = document.getElementById('view_voters_list_ward');
      if (el) {
        el.value = 'ErLm8ogX7Y';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    console.log("Waiting 3 seconds for Polling Stations to load...");
    await page.waitForTimeout(3000);

    // Let's check the options in the Polling Station dropdown
    const pollingOptions = await page.evaluate(() => {
      const el = document.getElementById('view_voters_list_pollingStation');
      if (!el) return [];
      return Array.from(el.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim()
      }));
    });

    console.log("Polling Stations for Ward 1 found:");
    console.log(JSON.stringify(pollingOptions, null, 2));

    // Also let's check what the Captcha selector is, the input field, and the submit button
    const formSelectors = await page.evaluate(() => {
      const img = document.querySelector('img[src*="captcha"], img[id*="captcha"], img[class*="captcha"]');
      
      // Let's find the input field for captcha. It might be near the captcha image, or have "captcha" in its id/name.
      const captchaInput = document.querySelector('input[name*="captcha" i], input[id*="captcha" i]');
      
      // Let's find all buttons and inputs in the form
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(el => ({
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        type: el.type,
        text: el.textContent.trim() || el.value
      }));
      
      return {
        captchaImg: img ? {
          tagName: img.tagName,
          id: img.id,
          className: img.className,
          src: img.src
        } : null,
        captchaInput: captchaInput ? {
          tagName: captchaInput.tagName,
          id: captchaInput.id,
          name: captchaInput.name,
          className: captchaInput.className
        } : null,
        buttons: buttons
      };
    });
    console.log("Form Selectors and Buttons found:");
    console.log(JSON.stringify(formSelectors, null, 2));

  } else {
    console.log("Could not find Balussery in local body list.");
  }
  
  await browser.close();
}

run().catch(console.error);

