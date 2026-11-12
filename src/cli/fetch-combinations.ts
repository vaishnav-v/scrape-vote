import fs from 'fs';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import {
  DEFAULT_LANGUAGE,
  SEC_URLS,
  SUPPORTED_LANGUAGES,
} from '../config/constants.js';
import { env } from '../config/env.js';
import type { Combination, SelectOption } from '../types/index.js';

interface CliOptions {
  districts: string[];
  localBodies: string[];
  language: SelectOption;
  languageExplicit: boolean;
  outputFile: string;
  concurrency: number;
  listDistrictsOnly: boolean;
  nonInteractive: boolean;
}

interface SecDropdownResponse {
  ops1?: SelectOption[];
}

function printHelp(): void {
  console.log(`
Usage: npm run fetch-combinations -- [options]

When run interactively without --district, loads all districts from SEC Kerala
and prompts you to select district(s), local body filter, and language.

Options:
  --district <id|name>     District ID or name (repeatable or comma-separated, or "all")
  --local-body <id|name>   Local body ID or name substring (repeatable or comma-separated)
  --language <E|M>         Voter list language: E (English) or M (Malayalam). Default: E
  --list-districts         Fetch and print all districts with their IDs, then exit
  --non-interactive        Skip prompts and use CLI flags / defaults (all districts, E)
  --out <path>             Output JSON file path. Default: ${env.combinationsFile}
  --concurrency <n>        Max concurrent HTTP requests. Default: ${env.fetchConcurrency}
  -h, --help               Show this help message
`);
}

function parseCliArgs(argv: string[]): CliOptions {
  const districts: string[] = [];
  const localBodies: string[] = [];
  let language: SelectOption = DEFAULT_LANGUAGE;
  let languageExplicit = false;
  let outputFile = env.combinationsFile;
  let concurrency = env.fetchConcurrency;
  let listDistrictsOnly = false;
  let nonInteractive = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '--list-districts') {
      listDistrictsOnly = true;
    } else if (arg === '--non-interactive') {
      nonInteractive = true;
    } else if (arg === '--district' && argv[i + 1]) {
      const vals = argv[++i]!.split(',').map((v) => v.trim()).filter(Boolean);
      districts.push(...vals);
    } else if (arg === '--local-body' && argv[i + 1]) {
      const vals = argv[++i]!.split(',').map((v) => v.trim()).filter(Boolean);
      localBodies.push(...vals);
    } else if (arg === '--language' && argv[i + 1]) {
      const code = argv[++i]!.trim().toUpperCase();
      const matched = SUPPORTED_LANGUAGES[code];
      if (!matched) {
        throw new Error(`Unsupported language "${code}". Use E or M.`);
      }
      language = matched;
      languageExplicit = true;
    } else if (arg === '--out' && argv[i + 1]) {
      outputFile = path.resolve(argv[++i]!);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      const parsed = Number.parseInt(argv[++i]!, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        throw new Error('Concurrency must be a positive integer.');
      }
      concurrency = parsed;
    }
  }

  return {
    districts,
    localBodies,
    language,
    languageExplicit,
    outputFile,
    concurrency,
    listDistrictsOnly,
    nonInteractive,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchDistrictsFromPage(retries = env.fetchRetries): Promise<SelectOption[]> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(SEC_URLS.VOTERS_LIST);
      if (!res.ok) {
        throw new Error(`Failed to fetch voters list page: HTTP ${res.status}`);
      }
      const html = await res.text();
      const selectMatch = html.match(
        /<select[^>]*id=["']view_voters_list_district["'][^>]*>([\s\S]*?)<\/select>/i,
      );
      if (!selectMatch || !selectMatch[1]) {
        throw new Error('Could not find district dropdown in voters list HTML.');
      }

      const options: SelectOption[] = [];
      const optionRegex =
        /<option[^>]*\bvalue=(?:["']([^"']*)["']|([^\s>]+))[^>]*>([\s\S]*?)<\/option>/gi;
      let match: RegExpExecArray | null;
      while ((match = optionRegex.exec(selectMatch[1])) !== null) {
        const value = (match[1] ?? match[2] ?? '').trim();
        const text = decodeHtmlEntities((match[3] ?? '').replace(/<[^>]+>/g, ''));
        if (value) {
          options.push({ value, text });
        }
      }
      return options;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt);
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function postFormWithRetry(
  url: string,
  bodyParams: Record<string, string>,
  retries = env.fetchRetries,
): Promise<SecDropdownResponse> {
  const body = new URLSearchParams(bodyParams).toString();
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as SecDropdownResponse;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt);
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      const item = items[current];
      if (item !== undefined) {
        await worker(item, current);
      }
    }
  });
  await Promise.all(runners);
}

function printOptionsList(title: string, items: SelectOption[]): void {
  console.log(`\n${title} (${items.length}):`);
  items.forEach((item, idx) => {
    const num = String(idx + 1).padStart(3, ' ');
    console.log(`  ${num}. ${item.text}  (ID: ${item.value})`);
  });
}

function resolveOptionSelection(items: SelectOption[], queries: string[]): SelectOption[] {
  if (queries.length === 0 || queries.some((q) => q.toLowerCase() === 'all')) {
    return items;
  }

  const selected: SelectOption[] = [];
  const seenValues = new Set<string>();

  for (const rawQuery of queries) {
    const q = rawQuery.trim();
    if (!q) continue;

    // 1. Exact ID match
    const byId = items.filter((item) => item.value.toLowerCase() === q.toLowerCase());
    if (byId.length > 0) {
      for (const item of byId) {
        if (!seenValues.has(item.value)) {
          seenValues.add(item.value);
          selected.push(item);
        }
      }
      continue;
    }

    // 2. 1-based list index match (if numeric)
    if (/^\d+$/.test(q)) {
      const idx = Number.parseInt(q, 10) - 1;
      const byIndex = items[idx];
      if (byIndex) {
        if (!seenValues.has(byIndex.value)) {
          seenValues.add(byIndex.value);
          selected.push(byIndex);
        }
        continue;
      }
    }

    // 3. Name substring match
    const byName = items.filter((item) =>
      item.text.toLowerCase().includes(q.toLowerCase()),
    );
    for (const item of byName) {
      if (!seenValues.has(item.value)) {
        seenValues.add(item.value);
        selected.push(item);
      }
    }
  }

  return selected;
}

async function promptDistricts(
  rl: readline.Interface,
  allDistricts: SelectOption[],
): Promise<SelectOption[]> {
  printOptionsList('Available Districts', allDistricts);
  console.log('   all. All Districts\n');

  while (true) {
    const answer = (
      await rl.question(
        'Select district(s) by number, ID, or name (comma-separated, e.g. 1,4) [all]: ',
      )
    ).trim();

    if (!answer || answer.toLowerCase() === 'all') {
      return allDistricts;
    }

    const queries = answer.split(',').map((s) => s.trim()).filter(Boolean);
    const matched = resolveOptionSelection(allDistricts, queries);
    if (matched.length > 0) {
      return matched;
    }
    console.log('No matching districts found. Please try again.');
  }
}

async function promptLocalBodiesForDistrict(
  rl: readline.Interface,
  district: SelectOption,
  localBodies: SelectOption[],
): Promise<SelectOption[]> {
  printOptionsList(`Local Bodies in ${district.text}`, localBodies);
  console.log('   all. All Local Bodies\n');

  while (true) {
    const answer = (
      await rl.question(
        'Select local body by number, ID, or name (comma-separated) [all]: ',
      )
    ).trim();

    if (!answer || answer.toLowerCase() === 'all') {
      return localBodies;
    }

    const queries = answer.split(',').map((s) => s.trim()).filter(Boolean);
    const matched = resolveOptionSelection(localBodies, queries);
    if (matched.length > 0) {
      return matched;
    }
    console.log('No matching local bodies found. Please try again.');
  }
}

async function promptLanguage(rl: readline.Interface): Promise<SelectOption> {
  while (true) {
    const answer = (
      await rl.question('Select language [E = English, M = Malayalam] [E]: ')
    )
      .trim()
      .toUpperCase();

    if (!answer) return DEFAULT_LANGUAGE;
    const matched = SUPPORTED_LANGUAGES[answer];
    if (matched) return matched;
    console.log('Invalid choice. Enter E or M.');
  }
}

async function run(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const isInteractive = Boolean(input.isTTY && !options.nonInteractive);

  console.log('Fetching districts from SEC Kerala...');
  const allDistricts = await fetchDistrictsFromPage();
  if (allDistricts.length === 0) {
    throw new Error('No districts found on SEC Kerala page.');
  }

  if (options.listDistrictsOnly) {
    printOptionsList('Available Districts', allDistricts);
    return;
  }

  const rl = isInteractive ? readline.createInterface({ input, output }) : null;

  try {
    let targetDistricts: SelectOption[];
    if (options.districts.length > 0) {
      targetDistricts = resolveOptionSelection(allDistricts, options.districts);
      if (targetDistricts.length === 0) {
        printOptionsList('Available Districts', allDistricts);
        throw new Error(`No districts matched filter: ${options.districts.join(', ')}`);
      }
    } else if (rl) {
      targetDistricts = await promptDistricts(rl, allDistricts);
    } else {
      targetDistricts = allDistricts;
    }

    let localBodyQueries = options.localBodies;
    if (rl && localBodyQueries.length === 0 && targetDistricts.length > 1) {
      const lbAnswer = (
        await rl.question(
          'Optional local body filter by ID or name (comma-separated, Enter for ALL) [all]: ',
        )
      ).trim();
      if (lbAnswer && lbAnswer.toLowerCase() !== 'all') {
        localBodyQueries = lbAnswer.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    let selectedLanguage = options.language;
    if (rl && !options.languageExplicit) {
      selectedLanguage = await promptLanguage(rl);
    }

    console.log(
      `\nSelected ${targetDistricts.length} district(s): ${targetDistricts
        .map((d) => `${d.text} (${d.value})`)
        .join(', ')} | Language: ${selectedLanguage.text}`,
    );

    const combinations: Combination[] = [];
    const seenKeys = new Set<string>();
    let totalLocalBodies = 0;
    let totalWards = 0;

    for (const district of targetDistricts) {
      console.log(`\n[District] ${district.text} (${district.value})`);
      const lbResp = await postFormWithRetry(SEC_URLS.LOCAL_BODIES_BY_DISTRICT, {
        objid: district.value,
      });
      let localBodies = (lbResp.ops1 ?? []).map((lb) => ({
        value: lb.value.trim(),
        text: lb.text.trim(),
      }));

      if (localBodyQueries.length > 0) {
        localBodies = resolveOptionSelection(localBodies, localBodyQueries);
      } else if (rl && targetDistricts.length === 1 && localBodies.length > 0) {
        localBodies = await promptLocalBodiesForDistrict(rl, district, localBodies);
      }

      totalLocalBodies += localBodies.length;
      console.log(`  Loading ${localBodies.length} local bodies (concurrency=${options.concurrency})...`);

      await runWithConcurrency(localBodies, options.concurrency, async (lb, idx) => {
        try {
          const wardResp = await postFormWithRetry(SEC_URLS.WARDS_BY_LOCAL_BODY, {
            objid: lb.value,
          });
          const wards = wardResp.ops1 ?? [];
          totalWards += wards.length;
          console.log(
            `  [${idx + 1}/${localBodies.length}] ${lb.text} (${lb.value}): ${wards.length} wards`,
          );

          for (const ward of wards) {
            const psResp = await postFormWithRetry(SEC_URLS.POLLING_STATIONS_BY_WARD, {
              objid: ward.value,
            });
            const pollingStations = psResp.ops1 ?? [];

            for (const ps of pollingStations) {
              const dedupeKey = `${district.value}_${lb.value}_${ward.value}_${ps.value}`;
              if (seenKeys.has(dedupeKey)) continue;
              seenKeys.add(dedupeKey);

              combinations.push({
                district,
                localBody: lb,
                ward: { value: ward.value.trim(), text: ward.text.trim() },
                pollingStation: { value: ps.value.trim(), text: ps.text.trim() },
                language: selectedLanguage,
              });
            }

            if (env.fetchDelayMs > 0) {
              await sleep(env.fetchDelayMs);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  Error processing Local Body ${lb.text}: ${msg}`);
        }
      });
    }

    const outDir = path.dirname(options.outputFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const tmpFile = `${options.outputFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(combinations, null, 2));
    fs.renameSync(tmpFile, options.outputFile);

    console.log('\n======================================================');
    console.log('Combinations crawl completed!');
    console.log(`Districts processed:  ${targetDistricts.length}`);
    console.log(`Local Bodies:         ${totalLocalBodies}`);
    console.log(`Wards:                ${totalWards}`);
    console.log(`Polling Stations:     ${combinations.length}`);
    console.log(`Saved to:             ${options.outputFile}`);
    console.log('======================================================\n');
  } finally {
    rl?.close();
  }
}

run().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
