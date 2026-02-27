# Deployment Guide

Link2Book requires a server environment that can run Playwright with Chromium.
It will **not** work on serverless or edge platforms.

## Environment Checklist

Before deploying to any platform:

- [ ] Real Turnstile site key + secret key (widget type: **Invisible**)
- [ ] `SESSION_SECRET` set to a random 32-byte value (`openssl rand -base64 32`)
- [ ] `NEXT_PUBLIC_APP_URL` set to your production domain

## Platforms That Will NOT Work

| Platform | Reason |
| --- | --- |
| **Vercel** | Serverless functions have a ~250MB size limit. Chromium alone exceeds this. |
| **Cloudflare Workers** | No Playwright support. Browser Rendering doesn't allow custom launch flags needed for stealth. |
| **AWS Lambda** | Possible with a Chromium layer but impractical due to cold start and timeout constraints. |

## Leapcell (Primary)

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

## Docker / VPS

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
npm run build
npm start
```

`install-deps` installs system libraries required by Chromium on Debian/Ubuntu. Not needed on macOS.

## Railway / Render / Fly.io

```bash
# Build command
npx playwright install chromium && npx playwright install-deps chromium && npm run build

# Start command
npm start
```

## Next Steps

- [Security](../04-security/01-api-protection.md)
- [Environment Variables](../02-development/01-getting-started.md#environment-variables)
