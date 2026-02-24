# link2book

> **WIP / POC** — Convert X (Twitter) Article links into EPUB books.

Paste the URL of an X Article post, get a clean `.epub` file back — ready to read in Apple Books, Kindle, or any EPUB reader.

## Stack

- **Next.js 15** (App Router) — frontend + API route
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **Cloudflare Browser Rendering** — headless Chromium to extract full article content from X's React SPA
- **JSZip** — custom EPUB 3 builder (no third-party EPUB library)

## How it works

1. User pastes an X Article URL
2. The syndication API (`cdn.syndication.twimg.com`) returns article metadata (title, author, cover image)
3. A headless browser (Cloudflare Browser Rendering) loads the full article page with auth cookies, scrolls through to trigger lazy rendering, and extracts the clean semantic HTML
4. A custom EPUB builder packages everything — embedded images, chapter TOC, proper XHTML — into a `.epub` zip

## Local dev

Requires a Cloudflare account with Browser Rendering enabled.

```bash
npm install
cp .dev.vars.example .dev.vars   # add your X auth cookies
npm run preview                   # wrangler dev with CF bindings
```

Secrets needed in `.dev.vars` (local) or via `wrangler secret put` (production):

```
X_AUTH_TOKEN=<your x.com auth_token cookie>
X_CT0=<your x.com ct0 cookie>
```

## Status

Early POC — X Articles only. Output tested against Apple Books.
