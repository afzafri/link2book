# link2book

> Convert X (Twitter) Article links into EPUB books.

Paste the URL of an X Article post, get a clean `.epub` file back — ready to read in Apple Books, Kindle, or any EPUB reader.

## Stack

- **Next.js 15** (App Router) — frontend + API route
- **Playwright** (via `playwright-extra`) — headless browser to extract full article content from React SPAs
- **puppeteer-extra-plugin-stealth** — bypasses bot detection without auth cookies
- **JSZip** — custom EPUB 3 builder (no third-party EPUB library)
- **sharp** — cover image processing (portrait book ratio 1:1.6, white letterbox fill) and body image conversion to JPEG for e-ink compatibility
- **Cloudflare Turnstile** — invisible captcha for API protection

## How it works

1. User pastes an X Article URL (status or direct article format)
2. The syndication API (`cdn.syndication.twimg.com`) returns article metadata — title, author display name, cover image
3. Playwright + stealth loads the full article page, dismisses the login overlay, scrolls through to trigger lazy rendering (code blocks, images), and extracts clean semantic HTML
4. The custom EPUB builder embeds all images, processes the cover to portrait ratio, generates a chapter TOC from `<h2>` headings, and packages everything into a valid EPUB 3 zip

## Accepted URL formats

```
https://x.com/Username/status/123456789       # tweet status link
https://x.com/Username/article/123456789      # direct article link
```

## Article scraper

The browser-based scraper (`lib/browser-article.ts`) handles X's React SPA rendering with several reliability mechanisms:

**Stable-height scrolling** — Scrolls in 500px steps and monitors `scrollHeight` after each step. Stops only when near the bottom AND page height has been stable for 6 consecutive checks. Handles dynamically growing pages that load content lazily via IntersectionObserver.

**Condition-based readiness** — After scrolling, waits for real signals instead of a blind timeout:
- Content stability (block count + scroll height unchanged for 6 samples at 150ms intervals)
- Code blocks populated (all `<code>` elements have non-empty text)
- Images loaded (all `<img>` elements report `complete`)
- A 200ms micro-buffer as final safety margin

**Deep block traversal** — Content extraction uses `querySelectorAll` to find all block-level elements (paragraphs, headings, sections, code blocks, images, lists, blockquotes) in document order, then filters nested duplicates. Avoids losing content when the page wraps blocks in additional container divs.

**Inline HTML preservation** — Links, bold, italic, code, and other inline formatting are preserved recursively. Multiple links in the same paragraph are all captured.

### Debug mode

```bash
DEBUG_SCRAPER=1 npm run dev
```

Or pass `{ debug: true }` to `fetchArticleWithBrowser()`. Logs scroll rounds, stability samples, and block counts from the browser context.

## EPUB output

- EPUB 3 compliant, validated against Apple Books
- Embedded images (cover + all body images — no external URLs)
- All images converted to JPEG for e-ink reader compatibility
- Cover image resized to portrait book ratio (600×960, 1:1.6) with white letterbox fill
- Chapter TOC from `<h2>` headings
- Clean semantic HTML extracted from X's Draft.js DOM structure
- Code blocks extracted from Prism.js tokenised spans via `textContent`
- Lists with nested sub-list support
- Multi-paragraph blockquotes
- Sections with mixed content (code + images + captions)

## Security

The `/api/convert` endpoint is protected by three layers to prevent direct API abuse:

### 1. Cloudflare Turnstile (captcha)

An invisible Turnstile widget runs a silent challenge on page load. The token is exchanged via `POST /api/session`, which verifies it with Cloudflare's API and sets a short-lived session cookie. Automated scripts can't call the API directly — they can't mint valid captcha tokens at scale.

### 2. Signed session cookie (`l2b_session`)

`/api/session` issues an HMAC-SHA256 signed HttpOnly cookie (SameSite=Strict) that expires in 10 minutes. Verified on every request to `/api/convert`. Requests without a valid cookie get a `401`.

### 3. CSRF header

Every request from the frontend sends `X-Requested-With: XMLHttpRequest`. Browsers don't send this header cross-origin, blocking drive-by API reuse from other websites. Requests without it get a `403`.

## Development

### Prerequisites

- Node.js 18+
- Chromium (installed via Playwright)

### Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
```

Fill in `.env.local`. For local dev, use Cloudflare's test keys (always pass silently, no account needed):

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SESSION_SECRET=any-random-string-for-local-dev
```

```bash
npm run dev
```

App runs at `http://localhost:3000`. No auth tokens or secrets needed for core functionality.

### Environment variables

```env
# Used for SEO and Meta tags
NEXT_PUBLIC_APP_URL=https://link2book.afifzafri.com

# API protection — Cloudflare Turnstile
# Widget type must be set to "Invisible" in the Cloudflare dashboard
# Get keys at https://dash.cloudflare.com/?to=/:account/turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_site_key_here
TURNSTILE_SECRET_KEY=your_secret_key_here

# Session signing secret — generate with: openssl rand -base64 32
SESSION_SECRET=your_random_secret_here
```

### Project structure

```
app/
  layout.tsx              - root layout (Turnstile script)
  page.tsx                - client page: URL input, convert button, download
  api/convert/route.ts    - POST /api/convert -> returns application/epub+zip
  api/session/route.ts    - POST /api/session -> verifies captcha, sets session cookie
lib/
  session.ts              - HMAC session token sign/verify
  browser-article.ts      - Playwright scraper for full article content
  parsers/x.ts            - X.com parser (syndication API + browser fallback)
  builders/epub.ts        - custom EPUB 3 builder (JSZip + sharp)
  html.ts                 - text -> safe HTML (code blocks, inline code, newlines)
  utils.ts                - sanitizeFilename, firstMeaningfulLine, randomToken
```

### Build

```bash
npm run build
npm start
```

## Deployment

The app requires a server environment that can run Playwright with Chromium. It will **not** work on serverless/edge platforms (Vercel, Cloudflare Workers) because Playwright needs a full browser binary.

### Environment checklist before deploying

- [ ] Real Turnstile site key + secret key (widget type: **Invisible**)
- [ ] `SESSION_SECRET` set to a random 32-byte value (`openssl rand -base64 32`)
- [ ] `NEXT_PUBLIC_APP_URL` set to your production domain

### Leapcell (primary)

[Leapcell](https://leapcell.io) supports Node.js apps with system dependencies.

**Build command:**

```bash
sh prepare_playwright_env.sh && npm install && npm run build
```

`prepare_playwright_env.sh` installs the Chromium binary and its system-level dependencies (libatk, libcups, etc.).

**Start command:**

```bash
npm start
```

### Docker / VPS

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
npm run build
npm start
```

`install-deps` installs system libraries required by Chromium on Debian/Ubuntu. Not needed on macOS.

### Railway / Render / Fly.io

```bash
# Build command
npx playwright install chromium && npx playwright install-deps chromium && npm run build

# Start command
npm start
```

### Platforms that will NOT work

- **Vercel** — Serverless functions have a ~250MB size limit. Chromium alone exceeds this.
- **Cloudflare Workers** — No Playwright support. Browser Rendering doesn't allow custom launch flags needed for stealth.
- **AWS Lambda** — Possible with a Chromium layer but impractical due to cold start and timeout constraints.

## Bot detection research — Puppeteer vs Playwright

### The problem

X Article pages are React SPAs. The full article body only renders after JavaScript executes, so server-side `fetch()` is not enough — a real headless browser is required. However, X detects headless browsers and shows a login wall instead of the article content.

### What was tried

**Puppeteer + stealth** — works on residential/local IPs, fails on Cloudflare Workers (datacenter IP gets flagged, no support for `--disable-blink-features=AutomationControlled`).

**Playwright + stealth** — same stealth plugin, but Playwright handles the `AutomationControlled` flag automatically. Works on local and self-hosted environments. X renders the article content underneath a login overlay which is dismissed via `page.evaluate()` after load. Does not work on Cloudflare Workers.

### Why Playwright works but Cloudflare doesn't

1. **No launch flags** — Cloudflare's managed browser doesn't allow custom Chromium launch args. Without `--disable-blink-features=AutomationControlled`, JS-level stealth patches are insufficient.
2. **Datacenter IP** — Cloudflare Workers runs from known datacenter IP ranges. X is more aggressive with bot detection for datacenter IPs regardless of browser fingerprint.

**Conclusion:** Self-hosting with Playwright on any standard VPS works because the IP is not specifically flagged and launch flags are fully controllable.

### Key implementation detail

X Article URLs use the **tweet/status ID** (not the article's internal `rest_id`) in the public URL path:

```
https://x.com/Username/article/{tweet_status_id}   correct
https://x.com/i/article/{article_rest_id}          shows empty state without auth
```

The syndication API returns `article.rest_id` which is a different ID from the tweet. The fix was to construct the article URL using the tweet ID instead.

## References

- **Project inspiration:** [send-to-x4](https://github.com/Xatpy/send-to-x4)
- **EPUB CSS reference:** [EPUB-CSS-Editor](https://github.com/Jungliana/EPUB-CSS-Editor), [epub-css-starter-kit](https://github.com/mattharrison/epub-css-starter-kit)

## Status

POC — X Articles only. Output tested against Apple Books and epub-reader.online.
