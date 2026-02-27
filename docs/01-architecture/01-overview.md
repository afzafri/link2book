# Architecture Overview

Link2Book is a stateless web application that converts X (Twitter) Article URLs into
fully formatted EPUB 3 books, streamed live to the browser.

## Project Vision

The system takes a public X Article URL and produces the following:

- A valid EPUB 3 file with embedded images
- A portrait-ratio cover image (1:1.6)
- A chapter table of contents derived from `<h2>` headings
- Clean semantic HTML extracted from X's Draft.js / React SPA DOM

The architecture is modular so additional content sources (Reddit, Medium, etc.) can be added later
without restructuring the core pipeline.

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Framework | Next.js 15 (App Router) | Frontend + API routes |
| Browser | Playwright + stealth plugin | Full JS rendering of X's React SPA |
| EPUB | Custom builder (JSZip + sharp) | EPUB 3 packaging, image processing |
| Cover | sharp | Resize + letterbox to portrait ratio |
| Security | Cloudflare Turnstile | Invisible captcha, session cookie, CSRF |
| Streaming | Server-Sent Events (SSE) | Live progress + content delivery |

## Project Structure

```text
app/
  layout.tsx                     - root layout (Turnstile script)
  page.tsx                       - client page: URL input, SSE consumer, paginated preview
  api/convert/route.ts           - POST /api/convert → epub+zip (direct)
  api/convert-stream/route.ts    - POST /api/convert-stream → SSE stream
  api/session/route.ts           - POST /api/session → verifies captcha, sets cookie
lib/
  session.ts              - HMAC session token sign/verify
  browser-article.ts      - Playwright scraper with real-time progress callbacks
  parsers/x.ts            - X.com parser (syndication API + browser)
  builders/epub.ts        - custom EPUB 3 builder
  html.ts                 - text → safe HTML (code blocks, inline code, newlines)
  utils.ts                - sanitizeFilename, firstMeaningfulLine, randomToken
```

## Conversion Pipeline

```text
URL input
  → X syndication API (title, author, cover image URL)
  → Playwright scraper (full article HTML, scroll + wait)
  → EPUB builder (embed images, generate TOC, package zip)
  → SSE stream (progress events + base64 EPUB in final event)
```

Each stage emits SSE progress events. See [API Reference](../02-development/02-api-reference.md) for the full event list.

## Parser Interface

The parser layer is designed to be platform-agnostic:

```typescript
interface ContentParser {
  canHandle(url: string): boolean
  parse(url: string): Promise<ParsedContent>
}
```

`ParsedContent` carries title, author, body HTML, images, and metadata.
The EPUB builder consumes only `ParsedContent` — it has no knowledge of the source platform.

## Non-Goals (v1)

- Thread unrolling
- Login-based scraping
- PDF / MOBI output
- User accounts or database persistence
- Multiple concurrent sources per request

## Accepted URL Formats

```text
https://x.com/Username/status/123456789       # tweet status link
https://x.com/Username/article/123456789      # direct article link
```

> **Note:** The URL must use the **tweet/status ID**, not the article's internal `rest_id`.
> The syndication API returns `article.rest_id` which differs from the public tweet ID.
> The scraper constructs the browser URL from the tweet ID.

## Next Steps

- [Scraper design](02-scraper.md)
- [EPUB builder](03-epub-builder.md)
- [Getting started](../02-development/01-getting-started.md)
