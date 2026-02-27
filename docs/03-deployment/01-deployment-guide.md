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

## Render (Primary)

[Render](https://render.com) is the recommended platform. It supports Docker-based deployments with full Playwright + Chromium support and SSE streaming works correctly out of the box.

A `Dockerfile` is included in the repo root. Render auto-detects it.

**Steps:**

1. Create a new **Web Service** on Render, connect your GitHub repo.
2. Render will detect the `Dockerfile` automatically — no build/start commands needed.
3. Add environment variables in the Render dashboard:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Check **"Available during build"** — required at build time |
| `NEXT_PUBLIC_APP_URL` | Check **"Available during build"** — required at build time |
| `TURNSTILE_SECRET_KEY` | Runtime only |
| `SESSION_SECRET` | Runtime only (`openssl rand -base64 32`) |

> `NEXT_PUBLIC_*` variables are inlined by Next.js at build time. They must be marked as available during build or the Turnstile widget and app URL will be undefined in production.

**Free tier note:** Render's free tier spins down after 15 minutes of inactivity. First request after idle incurs a ~30s cold start.

## Docker / VPS

The included `Dockerfile` works on any Docker-capable host:

```bash
docker build \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_key \
  --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com \
  -t link2book .

docker run -p 3000:3000 \
  -e TURNSTILE_SECRET_KEY=your_secret \
  -e SESSION_SECRET=your_session_secret \
  link2book
```

## Railway / Fly.io

Use the same `Dockerfile`. Pass `NEXT_PUBLIC_*` vars as build arguments in the platform's dashboard or CLI.

## Leapcell

[Leapcell](https://leapcell.io) supports Node.js apps with system dependencies via a build script.

**Build command:**

```bash
sh prepare_playwright_env.sh && npm install && npm run build
```

**Start command:**

```bash
npm start
```

> **Known issue:** SSE streaming does not work reliably on Leapcell. The response arrives all at once instead of progressively, even with `X-Accel-Buffering: no` and `X-Content-Type-Options: nosniff` headers set. Root cause is unclear — likely Leapcell's proxy layer buffers the response regardless of headers. Use Render instead if streaming is required.

## Next Steps

- [Security](../04-security/01-api-protection.md)
- [Environment Variables](../02-development/01-getting-started.md#environment-variables)
