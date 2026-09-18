import fs from 'fs';

const API_BASE = 'https://sec.kerala.gov.in';

async function postForm(url, bodyParams) {
  const body = new URLSearchParams(bodyParams).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body
  });
  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status} for ${url}`);
  }
  return res.json();
}

async function run() {
  console.log("Crawl started. Querying all Kozhikode options (District ID: 4)...");
  
  // 1. Get all local bodies under District 4
  console.log("Fetching local bodies under Kozhikode...");
  const lbData = await postForm(`${API_BASE}/public/getalllbcmp/byd`, { objid: '4' });
  const localBodies = lbData.ops1 || [];
  console.log(`Found ${localBodies.length} local bodies.`);

  const combinations = [];
  let totalWardsCount = 0;

  // Let's crawl each local body
  for (let i = 0; i < localBodies.length; i++) {
    const lb = localBodies[i];
    console.log(`[Local Body ${i + 1}/${localBodies.length}] Fetching wards for: ${lb.text} (${lb.value})...`);

    try {
      // 2. Fetch Wards for this Local Body
      const wardData = await postForm(`${API_BASE}/public/getwardSbox`, { objid: lb.value });
      const wards = wardData.ops1 || [];
      console.log(`  -> Found ${wards.length} wards.`);
      totalWardsCount += wards.length;

      // 3. For each ward, fetch Polling Stations
      for (const ward of wards) {
        // Fetch Polling Stations
        const psData = await postForm(`${API_BASE}/public/getps/byward`, { objid: ward.value });
        const pollingStations = psData.ops1 || [];

        for (const ps of pollingStations) {
          combinations.push({
            district: { value: '4', text: 'KOZHIKODE' },
            localBody: { value: lb.value, text: lb.text },
            ward: { value: ward.value, text: ward.text },
            pollingStation: { value: ps.value, text: ps.text },
            language: { value: 'E', text: 'English' }
          });
        }
      }
    } catch (err) {
      console.error(`  Error processing Local Body ${lb.text}:`, err.message);
    }
    
    // Brief sleep to avoid hitting server too hard
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Save the full list
  fs.writeFileSync('combinations.json', JSON.stringify(combinations, null, 2));
  console.log(`\n======================================================`);
  console.log(`Crawl completed!`);
  console.log(`Total Local Bodies: ${localBodies.length}`);
  console.log(`Total Wards: ${totalWardsCount}`);
  console.log(`Total Combinations (Polling Stations): ${combinations.length}`);
  console.log(`Saved results to combinations.json`);
  console.log(`======================================================\n`);
}

run().catch(console.error);
