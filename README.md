# link2book

> **WIP / POC** — Convert X (Twitter) Article links into EPUB books.

Paste the URL of an X Article post, get a clean `.epub` file back — ready to read in Apple Books, Kindle, or any EPUB reader.

## Stack

- **Next.js 15** (App Router) — frontend + API route
- **Playwright** (via `playwright-extra`) — headless browser to extract full article content from X's React SPA
- **puppeteer-extra-plugin-stealth** — bypasses X's bot detection without auth cookies
- **JSZip** — custom EPUB 3 builder (no third-party EPUB library)
- **sharp** — cover image processing (portrait book ratio 1:1.6, white letterbox fill)

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

## Local dev

```bash
npm install
npx playwright install chromium
npm run dev
```

No auth tokens or secrets needed.

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
https://x.com/Username/article/{tweet_status_id}   ✓ correct
https://x.com/i/article/{article_rest_id}          ✗ shows empty state without auth
```

This caused a subtle bug: the syndication API returns `article.rest_id` which is a different ID from the tweet. The fix was to construct the article URL using the tweet ID instead.

## EPUB output

- EPUB 3 compliant, validated against Apple Books (gold standard target)
- Embedded images (cover + all body images — no external URLs)
- Cover image resized to portrait book ratio (600×960, 1:1.6) with white letterbox fill
- Chapter TOC from `<h2>` headings
- Clean semantic HTML extracted from X's Draft.js DOM structure
- Code blocks extracted from Prism.js tokenised spans via `textContent`

## References

- **Project inspiration:** [send-to-x4](https://github.com/Xatpy/send-to-x4)
- **EPUB CSS reference:** [EPUB-CSS-Editor](https://github.com/Jungliana/EPUB-CSS-Editor), [epub-css-starter-kit](https://github.com/mattharrison/epub-css-starter-kit)

## Status

POC — X Articles only. Output tested against Apple Books and epub-reader.online.
