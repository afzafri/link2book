# Getting Started

This guide covers everything needed to run Link2Book locally.

## Prerequisites

- **Node.js 18+**
- **Chromium** — installed via Playwright

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
```

Fill in `.env.local` with the values below.

## Environment Variables

```env
# Used for SEO and meta tags
NEXT_PUBLIC_APP_URL=https://link2book.afifzafri.com

# API protection — Cloudflare Turnstile
# Widget type must be "Invisible" in the Cloudflare dashboard
# Get keys at https://dash.cloudflare.com/?to=/:account/turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_site_key_here
TURNSTILE_SECRET_KEY=your_secret_key_here

# Session signing secret — generate with: openssl rand -base64 32
SESSION_SECRET=your_random_secret_here
```

### Local dev — Turnstile test keys

For local development, use Cloudflare's test keys. No Cloudflare account needed:

| Scenario | Site Key | Secret Key |
| --- | --- | --- |
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AB` |

Recommended `.env.local` for local dev:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SESSION_SECRET=any-random-string-for-local-dev
```

## Running the Dev Server

```bash
npm run dev
```

App runs at `http://localhost:3000`.

## Debug Mode

Enable verbose scraper logging (scroll rounds, block counts, stability samples):

```bash
DEBUG_SCRAPER=1 npm run dev
```

Or pass `{ debug: true }` to `fetchArticleWithBrowser()` directly.

## Building

```bash
npm run build
npm start
```

## Next Steps

- [API Reference](02-api-reference.md)
- [Deployment Guide](../03-deployment/01-deployment-guide.md)
