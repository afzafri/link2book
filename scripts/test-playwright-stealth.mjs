/**
 * Local Playwright + stealth test — no auth cookies.
 * Tests whether Playwright + stealth can access an X Article without login.
 *
 * Usage:
 *   node scripts/test-playwright-stealth.mjs <x_article_url>
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/test-playwright-stealth.mjs <x_article_url>");
  process.exit(1);
}

console.log("Launching Playwright + stealth (no cookies)...");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "en-US",
});
const page = await context.newPage();

console.log(`Navigating to: ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

// Wait for React to hydrate
await page.waitForFunction(
  () => document.body && document.body.children.length > 2,
  { timeout: 15000 }
).catch(() => null);

// Wait for article body specifically
await page.waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 15000 }).catch(() => null);

// Try to dismiss the login overlay if present
await page.evaluate(() => {
  document.querySelectorAll('[data-testid="login"], [data-testid="LoginForm"]').forEach(el => el.remove());
  // Also remove any modal backdrops
  document.querySelectorAll('[aria-modal="true"], [role="dialog"]').forEach(el => el.remove());
});

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
