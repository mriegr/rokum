#!/usr/bin/env bun

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PaginationConfig = {
  page: number;
  pageUrl: string;
};

type VenueRef = {
  href: string;
};

type VenueAddress = {
  streetAddress?: string | null;
  postalCode?: string | null;
  addressLocality?: string | null;
  addressCountry?: string | null;
};

type VenueGeo = {
  latitude?: string | number | null;
  longitude?: string | number | null;
};

type VenueRecord = {
  name: string | null;
  href: string;
  slug: string;
  categories: string[];
  address: VenueAddress | null;
  geo: VenueGeo | null;
  telephone: string | null;
};

type CliArgs = {
  url: string;
  output: string;
  concurrency: number;
  browser: boolean;
  headless: boolean;
  fetch: boolean;
};

const DEFAULT_URL =
  "https://urbansportsclub.com/en/venues?city_id=2&business_type%5B%5D=b2c&plan_type=3";
const DEFAULT_OUTPUT = "urbansportsclub-venues-with-addresses.json";
const DEFAULT_CONCURRENCY = 6;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function parseArgs(argv: string[]) {
  const result: CliArgs = {
    url: DEFAULT_URL,
    output: DEFAULT_OUTPUT,
    concurrency: DEFAULT_CONCURRENCY,
    browser: true,
    headless: false,
    fetch: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" || arg === "-u") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      result.url = value;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      result.output = value;
      continue;
    }
    if (arg === "--concurrency" || arg === "-c") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid concurrency value: ${value}`);
      }
      result.concurrency = Math.floor(parsed);
      continue;
    }
    if (arg === "--browser") {
      result.browser = true;
      result.fetch = false;
      continue;
    }
    if (arg === "--headless") {
      result.headless = true;
      continue;
    }
    if (arg === "--fetch") {
      result.fetch = true;
      result.browser = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  return result;
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun scripts/urbansportsclub-studios.ts [options]

Options:
  -u, --url <url>            Listing URL to start from
  -o, --output <path>        Output JSON file path
  -c, --concurrency <n>      Number of venue detail pages to fetch in parallel
      --browser              Use Playwright Chromium to collect the venue list (default)
      --headless             Run Playwright headless when --browser is set
      --fetch                Disable browser mode and use direct HTTP requests
  -h, --help                 Show this help

Examples:
  bun scripts/urbansportsclub-studios.ts
  bun scripts/urbansportsclub-studios.ts --output data/munich.json
  bun scripts/urbansportsclub-studios.ts --url 'https://urbansportsclub.com/en/venues?city_id=2&business_type%5B%5D=b2c&plan_type=3'
`.trim());
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function jitter(minMs = 350, maxMs = 1250) {
  await sleep(randomInt(minMs, maxMs));
}

async function ensureMunichCitySelected(page: any) {
  const venueCount = async () => {
    return await page.locator('.smm-studio-snippet').count();
  };

  const tryModalButton = async () => {
    const modalButton = page
      .locator("#modal-city .usc-city-dropdown__city-link")
      .filter({ hasText: /Munich|München/i })
      .first();

    if (await modalButton.count()) {
      await jitter(250, 700);
      await modalButton.click({ timeout: 3000 });
      await page.waitForTimeout(randomInt(1200, 2500));
      return true;
    }

    return false;
  };

  const trySelect = async (selector: string) => {
    const select = page.locator(selector);
    if (!(await select.count())) return false;

    const current = await select.evaluate((node: HTMLSelectElement) => {
      return node.selectedOptions?.[0]?.textContent?.trim() || node.value || "";
    });
    if (/Munich|München/i.test(String(current))) return true;

    await jitter(250, 700);
    try {
      await select.selectOption({ label: "Munich" });
    } catch {
      await select.selectOption("2");
    }
    await page.waitForTimeout(randomInt(1000, 2200));
    return true;
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await venueCount()) > 0) {
      return;
    }

    if (await tryModalButton()) {
      if ((await venueCount()) > 0) return;
    }

    if (await trySelect("select#city")) {
      if ((await venueCount()) > 0) return;
    }

    if (await trySelect("select#city_id")) {
      if ((await venueCount()) > 0) return;
    }

    const chosen = page.locator("#city_id_chosen .chosen-single");
    if (await chosen.count()) {
      const text = await chosen.textContent().catch(() => "");
      if (!/Munich|München/i.test(String(text))) {
        await jitter(250, 700);
        await chosen.click({ timeout: 3000 });
        await page.waitForTimeout(randomInt(500, 900));
        const option = page
          .locator("#city_id_chosen .chosen-drop .chosen-results li, #city_id_chosen .chosen-drop li")
          .filter({ hasText: /Munich|München/i })
          .first();
        if (await option.count()) {
          await option.click({ timeout: 3000 });
          await page.waitForTimeout(randomInt(1200, 2500));
          if ((await venueCount()) > 0) return;
        }
      }
    }

    await page.waitForTimeout(randomInt(700, 1400));
  }

  if ((await venueCount()) === 0) {
    throw new Error("Could not confirm Munich in the city selector modal");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripPaginationParams(search: URLSearchParams) {
  const cleaned = new URLSearchParams(search);
  cleaned.delete("page");
  cleaned.delete("previous-pages");
  return cleaned;
}

function attrsFromTag(tag: string) {
  const attrs = new Map<string, string>();
  const attrPattern = /([a-zA-Z0-9:_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(tag))) {
    attrs.set(match[1], decodeHtmlEntities(match[2]));
  }
  return attrs;
}

function extractPaginationConfig(html: string): PaginationConfig {
  const tagMatch = html.match(
    /<div[^>]*class="[^"]*\bsmm-pagination\b[^"]*"[^>]*>/i,
  );
  if (!tagMatch) {
    throw new Error("Could not find Urban Sports Club pagination container");
  }

  const attrs = attrsFromTag(tagMatch[0]);
  const page = Number(attrs.get("data-page"));
  const pageUrl = attrs.get("data-page-url");

  if (!Number.isFinite(page) || !pageUrl) {
    throw new Error("Pagination container is missing data-page or data-page-url");
  }

  return { page, pageUrl };
}

function extractVenueHrefs(html: string, baseUrl: string) {
  const hrefs = new Set<string>();
  const hrefPattern = /href\s*=\s*"([^"]*\/[a-z]{2}\/venues\/[^"]*)"/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html))) {
    const rawHref = decodeHtmlEntities(match[1]);
    try {
      const url = new URL(rawHref, baseUrl);
      if (/^\/[a-z]{2}\/venues\//i.test(url.pathname)) {
        url.hash = "";
        url.search = "";
        hrefs.add(url.toString());
      }
    } catch {
      // Ignore malformed links.
    }
  }

  return hrefs;
}

function mergeVenueHrefs(target: Set<string>, html: string, baseUrl: string) {
  for (const href of extractVenueHrefs(html, baseUrl)) target.add(href);
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractVenueBlocks(html: string) {
  const startPattern = /<div[^>]*class="[^"]*\bsmm-studio-snippet\b[^"]*"[^>]*>/gi;
  const starts = [...html.matchAll(startPattern)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  if (starts.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    blocks.push(html.slice(start, end));
  }
  return blocks;
}

function extractCategoriesFromBlock(block: string) {
  const disciplinesMatch = block.match(
    /<div[^>]*class="[^"]*\bsmm-studio-snippet__disciplines\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const disciplinesText = disciplinesMatch
    ? stripHtml(decodeHtmlEntities(disciplinesMatch[1]))
    : "";

  return [...new Set(
    disciplinesText
      .split("·")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function extractVenueSummaries(html: string, baseUrl: string) {
  const summaries = new Map<string, { name: string | null; categories: string[] }>();

  for (const block of extractVenueBlocks(html)) {
    const linkMatch = block.match(
      /<a[^>]*class="[^"]*\bsmm-studio-snippet__studio-link\b[^"]*"[^>]*href="([^"]+)"/i,
    );
    if (!linkMatch) continue;

    const rawHref = decodeHtmlEntities(linkMatch[1]);
    let href: string;
    try {
      const url = new URL(rawHref, baseUrl);
      url.hash = "";
      url.search = "";
      href = url.toString();
    } catch {
      continue;
    }

    const nameMatch = block.match(
      /<p[^>]*class="[^"]*\bsmm-studio-snippet__title\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    const name = nameMatch ? stripHtml(decodeHtmlEntities(nameMatch[1])) : null;
    const categories = extractCategoriesFromBlock(block);
    const previous = summaries.get(href);

    summaries.set(href, {
      name: previous?.name ?? name,
      categories: Array.from(new Set([...(previous?.categories ?? []), ...categories])),
    });
  }

  return summaries;
}

async function fetchText(url: string, attempts = 3) {
  let lastError: unknown = null;

  for (let i = 0; i < attempts; i++) {
    try {
      await jitter(250, 900);
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept:
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await sleep(750 * (i + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  const text = await fetchText(url, attempts);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${(error as Error).message}`);
  }
}

async function collectVenueRefsFromBrowser(page: any, startUrl: string) {
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(10000);

  console.log("Opening venue listing in Playwright");
  await jitter(700, 1800);
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(randomInt(1500, 3200));
  console.log("Checking city selection");
  await ensureMunichCitySelected(page);
  console.log("City selection confirmed");

  const venueCards = page.locator(".smm-studio-snippet");
  const showMoreButton = page
    .getByRole("button", { name: /(?:Mehr anzeigen|Show more)/i })
    .first();

  let lastCount = -1;
  let stableRounds = 0;

  while (stableRounds < 3) {
    await page.waitForTimeout(randomInt(500, 1200));

    const count = await venueCards.count();
    if (count === lastCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
    lastCount = count;

    if (!(await showMoreButton.count())) {
      break;
    }

    const visible = await showMoreButton.isVisible().catch(() => false);
    if (!visible) {
      break;
    }

    await jitter(900, 2200);
    await showMoreButton.click({ timeout: 5000 }).catch(async () => {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll("main button")].find((el) =>
          /(?:Mehr anzeigen|Show more)/i.test(el.textContent ?? ""),
        ) as HTMLButtonElement | undefined;
        button?.click();
      });
    });

    await page.waitForTimeout(randomInt(1500, 3200));
    console.log(`Expanded venue list to ${await venueCards.count()} cards`);
  }

  const hrefs = await page.evaluate(() => {
    const result = new Set<string>();
    const links = [
      ...document.querySelectorAll('main a[href*="/de/venues/"], main a[href*="/en/venues/"]'),
    ];
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      if (href) result.add(href.replace(/[?#].*$/, ""));
    }
    return [...result];
  });

  const summaries = await page.evaluate(() => {
    const result = new Map<string, { name: string | null; categories: string[] }>();
    const blocks = [...document.querySelectorAll(".smm-studio-snippet")];

    for (const block of blocks) {
      const link = block.querySelector<HTMLAnchorElement>("a.smm-studio-snippet__studio-link");
      if (!link?.href) continue;

      const href = link.href.replace(/[?#].*$/, "");
      const title =
        block.querySelector(".smm-studio-snippet__title")?.textContent?.trim() ||
        link.textContent?.trim() ||
        null;
      const disciplinesText =
        block.querySelector(".smm-studio-snippet__disciplines")?.textContent?.trim() || "";
      const categories = Array.from(
        new Set(
          disciplinesText
            .split("·")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );

      const previous = result.get(href);
      result.set(href, {
        name: previous?.name ?? title,
        categories: Array.from(new Set([...(previous?.categories ?? []), ...categories])),
      });
    }

    return Array.from(result.entries());
  });

  console.log(`Collected ${hrefs.length} venue URLs from listing page`);
  return { hrefs, summaries: new Map(summaries) };
}

async function scrapeVenueDetailsWithBrowser(
  browser: any,
  hrefs: string[],
  summaries: Map<string, { name: string | null; categories: string[] }>,
  concurrency: number,
) {
  return await mapPool(hrefs, Math.min(concurrency, 4), async (href, index) => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });

    try {
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(10000);
      await jitter(500, 1600);
      await page.goto(href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(randomInt(1200, 2600));

      const html = await page.content();
      const record = extractVenueDetails(html, href);
      const summary = summaries.get(href);
      if (summary) {
        if (!record.name) record.name = summary.name;
        record.categories = summary.categories;
      }

      console.log(
        `[${index + 1}/${hrefs.length}] ${record.name ?? record.slug} ${
          record.address?.streetAddress ? `- ${record.address.streetAddress}` : "- no street address"
        }`,
      );

      return record;
    } finally {
      await page.close().catch(() => {});
    }
  });
}

async function collectVenueRefsWithBrowser(
  startUrl: string,
  headless: boolean,
  concurrency: number,
) {
  let chromium: any;
  try {
    ({ chromium } = (await import("playwright")) as any);
  } catch {
    throw new Error(
      "Playwright is not installed. Run `bun add playwright` or use the default fetch mode.",
    );
  }

  const runtimeDir = mkdtempSync(join(tmpdir(), "usc-playwright-"));
  const homeDir = join(runtimeDir, "home");
  const cacheDir = join(runtimeDir, "cache");
  const configDir = join(runtimeDir, "config");
  const dataDir = join(runtimeDir, "data");

  for (const dir of [homeDir, cacheDir, configDir, dataDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless,
    chromiumSandbox: false,
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_CONFIG_HOME: configDir,
      XDG_DATA_HOME: dataDir,
    },
    args: [
      "--disable-crash-reporter",
      "--disable-crashpad",
      "--noerrdialogs",
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const venueData = await collectVenueRefsFromBrowser(page, startUrl);
    await page.close().catch(() => {});

    const records = await scrapeVenueDetailsWithBrowser(
      browser,
      venueData.hrefs,
      venueData.summaries,
      concurrency,
    );

    return { ...venueData, records };
  } finally {
    await browser.close();
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

function buildPaginationUrl(
  pageUrl: string,
  baseUrl: string,
  search: URLSearchParams,
  page: number,
) {
  const resolved = new URL(pageUrl, baseUrl);
  const params = stripPaginationParams(search);
  params.set("page", String(page));
  resolved.search = params.toString();
  return resolved.toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findLocalBusinessNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLocalBusinessNode(item);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(value)) {
    return null;
  }

  const type = value["@type"];
  const hasLocalBusinessType = Array.isArray(type)
    ? type.some((entry) => String(entry).toLowerCase().includes("localbusiness"))
    : typeof type === "string" && type.toLowerCase().includes("localbusiness");

  const address = isObject(value.address) ? value.address : null;
  if (hasLocalBusinessType || (address && (address.streetAddress || address.postalCode))) {
    return value;
  }

  if (isObject(value["@graph"])) {
    const found = findLocalBusinessNode(value["@graph"]);
    if (found) return found;
  }

  for (const nested of Object.values(value)) {
    const found = findLocalBusinessNode(nested);
    if (found) return found;
  }

  return null;
}

function extractVenueDetails(html: string, href: string): VenueRecord {
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  for (const rawScript of scripts) {
    try {
      const parsed = JSON.parse(rawScript) as unknown;
      const node = findLocalBusinessNode(parsed);
      if (!node) continue;

      const address = isObject(node.address)
        ? {
            streetAddress:
              typeof node.address.streetAddress === "string"
                ? node.address.streetAddress
                : null,
            postalCode:
              typeof node.address.postalCode === "string"
                ? node.address.postalCode
                : null,
            addressLocality:
              typeof node.address.addressLocality === "string"
                ? node.address.addressLocality
                : null,
            addressCountry:
              typeof node.address.addressCountry === "string"
                ? node.address.addressCountry
                : null,
          }
        : null;

      const geo = isObject(node.geo)
        ? {
            latitude:
              typeof node.geo.latitude === "string" || typeof node.geo.latitude === "number"
                ? node.geo.latitude
                : null,
            longitude:
              typeof node.geo.longitude === "string" || typeof node.geo.longitude === "number"
                ? node.geo.longitude
                : null,
          }
        : null;

      return {
        name: typeof node.name === "string" ? node.name : null,
        href,
        slug: new URL(href).pathname,
        categories: [],
        address,
        geo,
        telephone: typeof node.telephone === "string" ? node.telephone : null,
      };
    } catch {
      // Continue trying other JSON-LD blocks on the page.
    }
  }

  return {
    name: null,
    href,
    slug: new URL(href).pathname,
    categories: [],
    address: null,
    geo: null,
    telephone: null,
  };
}

async function collectVenueRefs(startUrl: string) {
  const startPageHtml = await fetchText(startUrl);
  const pagination = extractPaginationConfig(startPageHtml);
  const origin = new URL(startUrl).origin;
  const search = new URL(startUrl).searchParams;

  const refs = new Set<string>();
  const summaries = new Map<string, { name: string | null; categories: string[] }>();
  mergeVenueHrefs(refs, startPageHtml, origin);
  for (const [href, summary] of extractVenueSummaries(startPageHtml, origin)) {
    summaries.set(href, summary);
  }

  let nextPage = pagination.page + 1;
  while (true) {
    const pageUrl = buildPaginationUrl(pagination.pageUrl, origin, search, nextPage);
    const payload = await fetchJson<{
      success?: boolean;
      data?: {
        content?: string;
        showMore?: boolean;
      };
    }>(pageUrl);

    if (!payload.success) {
      throw new Error(`Pagination request failed for ${pageUrl}`);
    }

    const content = payload.data?.content ?? "";
    mergeVenueHrefs(refs, content, origin);
    for (const [href, summary] of extractVenueSummaries(content, origin)) {
      const previous = summaries.get(href);
      summaries.set(href, {
        name: previous?.name ?? summary.name,
        categories: Array.from(
          new Set([...(previous?.categories ?? []), ...summary.categories]),
        ),
      });
    }

    if (!payload.data?.showMore) {
      break;
    }

    nextPage += 1;
  }

  return {
    hrefs: [...refs],
    summaries,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const startUrl = args.url;
  const outputPath = args.output;

  console.log(`Fetching studio list from ${startUrl}`);
  let venueData:
    | {
        hrefs: string[];
        summaries: Map<string, { name: string | null; categories: string[] }>;
        records: VenueRecord[];
      }
    | {
        hrefs: string[];
        summaries: Map<string, { name: string | null; categories: string[] }>;
      };

  if (args.browser) {
    venueData = await collectVenueRefsWithBrowser(startUrl, args.headless, args.concurrency);
  } else {
    venueData = await collectVenueRefs(startUrl);
  }

  const venueHrefs = venueData.hrefs;
  console.log(`Found ${venueHrefs.length} unique studio URLs`);

  const records =
    "records" in venueData
      ? venueData.records
      : await mapPool(
          venueHrefs,
          args.concurrency,
          async (href, index) => {
            const html = await fetchText(href);
            const record = extractVenueDetails(html, href);
            const summary = venueData.summaries.get(href);
            if (summary) {
              if (!record.name) record.name = summary.name;
              record.categories = summary.categories;
            }
            console.log(
              `[${index + 1}/${venueHrefs.length}] ${record.name ?? record.slug} ${
                record.address?.streetAddress
                  ? `- ${record.address.streetAddress}`
                  : "- no street address"
              }`,
            );
            return record;
          },
        );

  const payload = {
    sourceUrl: startUrl,
    scrapedAt: new Date().toISOString(),
    count: records.length,
    venues: records,
  };

  await Bun.write(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} venues to ${outputPath}`);

  const missingStreetAddress = records.filter((venue) => !venue.address?.streetAddress).length;
  if (missingStreetAddress > 0) {
    console.log(`Warning: ${missingStreetAddress} venues do not expose a street address in JSON-LD`);
  }
}

await main();
