# link2book

> Convert X (Twitter) Article links into EPUB books.

Paste the URL of an X Article post, get a clean `.epub` file back — ready to read in Apple Books, Kindle, or any EPUB reader.

## Stack

- **Next.js 15** (App Router) — frontend + API route
- **Playwright** (via `playwright-extra`) — headless browser to extract full article content from X's React SPA
- **puppeteer-extra-plugin-stealth** — bypasses X's bot detection without auth cookies
- **JSZip** — custom EPUB 3 builder (no third-party EPUB library)
- **sharp** — cover image processing (portrait book ratio 1:1.6, white letterbox fill) and body image conversion to JPEG for e-ink compatibility

## How it works

1. User pastes an X Article URL (status or direct article format)
2. The syndication API (`cdn.syndication.twimg.com`) returns article metadata — title, author display name, cover image
3. Playwright + stealth loads the full article page, dismisses the login overlay, scrolls through to trigger lazy rendering (code blocks, images), and extracts clean semantic HTML
4. The custom EPUB builder embeds all images, processes the cover to portrait ratio, generates a chapter TOC from `<h2>` headings, and packages everything into a valid EPUB 3 zip

## Accepted URL formats

Both formats work:

```
https://x.com/Username/status/123456789       # tweet status link
https://x.com/Username/article/123456789      # direct article link
```

## Article scraper

The browser-based scraper (`lib/browser-article.ts`) handles X's React SPA rendering with several reliability mechanisms:

**Stable-height scrolling** — Instead of a fixed scroll-to-bottom, the scraper scrolls in 500px steps and monitors `scrollHeight` after each step. It only stops when near the bottom AND the page height has been stable for 6 consecutive checks. This handles dynamically growing pages that load content lazily via IntersectionObserver.

**Condition-based readiness** — After scrolling, the scraper waits for real signals instead of a blind timeout:
- Content stability (block count + scroll height unchanged for 6 samples at 150ms intervals)
- Code blocks populated (all `<code>` elements have non-empty text)
- Images loaded (all `<img>` elements report `complete`)
- A 200ms micro-buffer as final safety margin

**Deep block traversal** — Content extraction uses `querySelectorAll` to find all block-level elements (paragraphs, headings, sections, code blocks, images, lists, blockquotes) in document order, then filters nested duplicates. This avoids losing content when X wraps blocks in additional container divs.

**Inline HTML preservation** — Links, bold, italic, code, and other inline formatting are preserved recursively. Multiple links in the same paragraph are all captured (no "first link only" shortcuts).

### Debug mode

Set `DEBUG_SCRAPER=1` to enable verbose logging from the browser context — scroll rounds, stability samples, block counts:

```bash
DEBUG_SCRAPER=1 npm run dev
```

Or pass `{ debug: true }` to `fetchArticleWithBrowser()`.

## EPUB output

- EPUB 3 compliant, validated against Apple Books (gold standard target)
- Embedded images (cover + all body images — no external URLs)
- All images converted to JPEG for e-ink reader compatibility (X CDN serves WebP by default)
- Cover image resized to portrait book ratio (600x960, 1:1.6) with white letterbox fill
- Chapter TOC from `<h2>` headings
- Clean semantic HTML extracted from X's Draft.js DOM structure
- Code blocks extracted from Prism.js tokenised spans via `textContent`
- Lists with nested sub-list support
- Multi-paragraph blockquotes
- Sections with mixed content (code + images + captions)

## Development

### Prerequisites

- Node.js 18+
- Chromium (installed via Playwright)

### Setup

```bash
npm install
npx playwright install chromium
npm run dev
```

No auth tokens or secrets needed. The app runs at `http://localhost:3000`.

### Build

```bash
npm run build
npm start
```

### Project structure

```
app/
  layout.tsx              - root layout
  page.tsx                - client page: URL input, convert button, download
  api/convert/route.ts    - POST /api/convert -> returns application/epub+zip
lib/
  browser-article.ts      - Playwright scraper for full article content
  parsers/x.ts            - X.com parser (syndication API + browser fallback)
  builders/epub.ts        - custom EPUB 3 builder (JSZip + sharp)
  html.ts                 - text -> safe HTML (code blocks, inline code, newlines)
  utils.ts                - sanitizeFilename, firstMeaningfulLine, randomToken
```

## Deployment

The app requires a server environment that can run Playwright with Chromium. It will **not** work on serverless/edge platforms (Vercel, Cloudflare Workers) because Playwright needs a full browser binary.

### Leapcell

[Leapcell](https://leapcell.io) is the primary deployment target. It supports Node.js apps with system dependencies.

**Build command** (set in Leapcell dashboard):

```bash
sh prepare_playwright_env.sh && npm install && npm run build
```

This runs `prepare_playwright_env.sh` which installs the Chromium binary and its system-level dependencies (libraries like `libatk`, `libcups`, etc.), then builds the Next.js app.

**Start command:**

```bash
npm start
```

**Port:** Leapcell auto-detects, or set to `3000`.

### Docker / VPS

For any Linux server or Docker container:

```bash
# Install deps + Chromium
npm install
npx playwright install chromium
npx playwright install-deps chromium

# Build and start
npm run build
npm start
```

The `install-deps` step installs system libraries required by Chromium on Linux (Debian/Ubuntu). On macOS this is not needed.

### Railway / Render / Fly.io

These platforms support persistent Node.js servers. Use a build command similar to Leapcell:

```bash
# Build command
npx playwright install chromium && npx playwright install-deps chromium && npm run build

# Start command
npm start
```

### Platforms that will NOT work

- **Vercel** — Serverless functions have a ~250MB size limit and short execution timeouts. Chromium alone exceeds this.
- **Cloudflare Workers** — No Playwright support. Cloudflare Browser Rendering exists but doesn't allow custom Chromium launch flags needed for stealth, and datacenter IPs get flagged by X's bot detection.
- **AWS Lambda** — Possible with a Chromium layer, but the 15-minute timeout and cold start latency make it impractical for browser scraping.

## Bot detection research — Puppeteer vs Playwright

During development, significant time was spent investigating X's bot detection. Key findings:

### The problem

X Article pages are React SPAs. The full article body only renders after JavaScript executes, so server-side `fetch()` is not enough — a real headless browser is required. However, X detects headless browsers and shows a login wall instead of the article content.

### What was tried

**Puppeteer + stealth (via `puppeteer-extra-plugin-stealth`)** — tested in `scripts/test-stealth.mjs`:
- Applies JS-level patches (`navigator.webdriver`, `chrome.runtime`, `navigator.plugins`, etc.)
- Works on residential/local IPs
- Fails on Cloudflare Workers (datacenter IP gets flagged, and `@cloudflare/puppeteer` does not allow passing `--disable-blink-features=AutomationControlled` as a launch flag)

**Playwright + stealth (via `playwright-extra`)** — tested in `scripts/test-playwright-stealth.mjs`:
- Same stealth plugin, but Playwright handles the `AutomationControlled` flag automatically
- Works on local and self-hosted environments
- X renders the article content underneath a login overlay — the overlay is dismissed via `page.evaluate()` after load
- Does **not** work on Cloudflare Workers (no Playwright support, and datacenter IP is still flagged)

### Why Playwright works but Cloudflare doesn't

The core issue with Cloudflare Browser Rendering is twofold:

1. **No launch flags** — Cloudflare's managed browser doesn't allow custom Chromium launch args. The `--disable-blink-features=AutomationControlled` flag is what tells Chrome to hide its automation signals at the engine level. Without it, the JS patches are insufficient.
2. **Datacenter IP** — Cloudflare Workers runs from known datacenter IP ranges. X is more aggressive with bot detection for datacenter IPs, regardless of how convincing the browser fingerprint is. Auth cookies bypassed this (an authenticated session is trusted from any IP), but the goal was to eliminate the cookie dependency entirely.

**Conclusion:** Self-hosting with Playwright on any standard VPS or cloud server works because the IP is not specifically flagged and launch flags are fully controllable.

### Key implementation detail

X Article URLs use the **tweet/status ID** (not the article's internal `rest_id`) in the public URL path:

```
https://x.com/Username/article/{tweet_status_id}   correct
https://x.com/i/article/{article_rest_id}          shows empty state without auth
```

This caused a subtle bug: the syndication API returns `article.rest_id` which is a different ID from the tweet. The fix was to construct the article URL using the tweet ID instead.

## References

- **Project inspiration:** [send-to-x4](https://github.com/Xatpy/send-to-x4)
- **EPUB CSS reference:** [EPUB-CSS-Editor](https://github.com/Jungliana/EPUB-CSS-Editor), [epub-css-starter-kit](https://github.com/mattharrison/epub-css-starter-kit)

## Status

POC — X Articles only. Output tested against Apple Books and epub-reader.online.
