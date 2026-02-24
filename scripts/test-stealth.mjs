/**
 * Puppeteer + manual stealth patches test — no auth cookies.
 * Ports the key evasions from puppeteer-extra-plugin-stealth manually
 * using page.evaluateOnNewDocument(), which is also available in @cloudflare/puppeteer.
 *
 * Usage:
 *   node scripts/test-stealth.mjs <x_article_url>
 */

import puppeteer from "puppeteer";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/test-stealth.mjs <x_article_url>");
  process.exit(1);
}

console.log("Launching Puppeteer + manual stealth patches (no cookies)...");
const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
  ],
});

const page = await browser.newPage();

await page.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);

// ── Stealth patches via evaluateOnNewDocument ──────────────────────────────
// These are the same patches applied by puppeteer-extra-plugin-stealth,
// rewritten without the plugin framework so they work with @cloudflare/puppeteer.

// 1. Remove navigator.webdriver
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
  });
});

// 2. Mock chrome.runtime (headless Chrome lacks this)
await page.evaluateOnNewDocument(() => {
  if (!window.chrome) {
    Object.defineProperty(window, "chrome", {
      writable: true,
      enumerable: true,
      configurable: false,
      value: {},
    });
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      get id() { return undefined; },
      connect: null,
      sendMessage: null,
    };
  }
});

// 3. Mock navigator.plugins (empty in headless)
await page.evaluateOnNewDocument(() => {
  const makePlugin = (name, description, filename, mimeTypes) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperty(plugin, "name", { value: name });
    Object.defineProperty(plugin, "description", { value: description });
    Object.defineProperty(plugin, "filename", { value: filename });
    Object.defineProperty(plugin, "length", { value: mimeTypes.length });
    return plugin;
  };

  // Use a simple non-empty plugins array
  Object.defineProperty(navigator, "plugins", {
    get: () => {
      const arr = [1, 2, 3]; // Just needs to be non-empty
      Object.setPrototypeOf(arr, PluginArray.prototype);
      return arr;
    },
  });
});

// 4. Fix notification permissions behaving as "denied" in headless
await page.evaluateOnNewDocument(() => {
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === "notifications"
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
});

// 5. Realistic language/vendor
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
});

// ── Navigation ──────────────────────────────────────────────────────────────
console.log(`Navigating to: ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

await page
  .waitForFunction(() => document.body && document.body.children.length > 2, { timeout: 15000 })
  .catch(() => null);

await page
  .waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 15000 })
  .catch(() => null);

// Dismiss login overlay if present
await page.evaluate(() => {
  document.querySelectorAll('[data-testid="login"], [data-testid="LoginForm"]').forEach(el => el.remove());
  document.querySelectorAll('[aria-modal="true"], [role="dialog"]').forEach(el => el.remove());
});

// ── Result ──────────────────────────────────────────────────────────────────
const result = await page.evaluate(() => {
  const articleBody = document.querySelector('[data-testid="twitterArticleRichTextView"]');
  const loginWall   = document.querySelector('[data-testid="LoginForm"]')
                   ?? document.querySelector('[data-testid="login"]')
                   ?? document.querySelector('input[name="text"]');
  const allTestIds  = Array.from(document.querySelectorAll("[data-testid]"))
                        .map(el => el.getAttribute("data-testid"))
                        .filter(Boolean);

  return {
    pageTitle: document.title,
    hasArticleBody: !!articleBody,
    hasLoginWall: !!loginWall,
    articleSnippet: articleBody ? articleBody.innerText.slice(0, 300) : null,
    allTestIds: [...new Set(allTestIds)],
  };
});

console.log("\n── Result ──────────────────────────────────────");
console.log("Page title:      ", result.pageTitle);
console.log("Has article body:", result.hasArticleBody);
console.log("Has login wall:  ", result.hasLoginWall);
if (result.articleSnippet) {
  console.log("\nArticle snippet:\n", result.articleSnippet);
}
console.log("\ndata-testid elements found:", result.allTestIds);

await browser.close();
