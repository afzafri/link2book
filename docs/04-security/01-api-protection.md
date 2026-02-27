# API Protection

The `/api/convert` and `/api/convert-stream` endpoints are protected by three layers to prevent
direct API abuse and automated scraping.

## How it Works

```text
1. Page loads → Turnstile widget runs a silent challenge → gets a token
2. Frontend POSTs token to /api/session
3. Server verifies token with Cloudflare → sets l2b_session HttpOnly cookie (10 min TTL)
4. /api/convert rejects requests that:
   - have no valid session cookie, or
   - are missing the X-Requested-With: XMLHttpRequest header
```

An automated script calling the API directly can't mint a valid captcha token.
Even if a session cookie is stolen, it expires in 10 minutes.

## Layer 1: Cloudflare Turnstile (Captcha)

An invisible Turnstile widget runs a silent challenge on page load. No user interaction required.

**Getting keys:**

1. Go to the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Click **Add widget**
3. Enter your domain (e.g. `link2book.afifzafri.com`)
4. Widget type: **Invisible**
5. Copy **Site Key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
6. Copy **Secret Key** → `TURNSTILE_SECRET_KEY`

Free tier: unlimited verifications.

**Frontend integration (`app/layout.tsx`):**

```tsx
import Script from "next/script";

// Inside <body>:
<Script
  src="https://challenges.cloudflare.com/turnstile/v0/api.js"
  strategy="afterInteractive"
/>
```

**Frontend init (`app/page.tsx`):**

- Add `<div id="cf-turnstile" style={{ display: "none" }} />` in JSX
- Call `await ensureSession()` at the start of the submit handler
- On `401` response: reset the widget with `window.turnstile?.reset(widgetIdRef.current)`

## Layer 2: Signed Session Cookie (`l2b_session`)

`/api/session` issues an HMAC-SHA256 signed HttpOnly cookie after verifying the Turnstile token.

Properties:

- `HttpOnly` — not accessible via JavaScript
- `SameSite=Strict` — not sent on cross-site requests
- 10-minute TTL

**`lib/session.ts`** — change only the cookie name constant:

```ts
export const SESSION_COOKIE = "l2b_session";
```

**`app/api/session/route.ts`** — verifies Turnstile token, sets cookie.

**Verification in `/api/convert` or `/api/convert-stream`:**

```ts
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

const cookieStore = await cookies();
const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
if (!sessionToken || !verifySession(sessionToken)) {
  return NextResponse.json(
    { error: "Session expired. Please refresh the page." },
    { status: 401 }
  );
}
```

## Layer 3: CSRF Header

Every request from the frontend sends:

```text
X-Requested-With: XMLHttpRequest
```

Browsers don't send this header cross-origin, blocking drive-by API reuse from other websites.

**Verification:**

```ts
const requestedWith = req.headers.get("x-requested-with");
if (!requestedWith || requestedWith.toLowerCase() !== "xmlhttprequest") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

## Environment Variables

```env
# Cloudflare Turnstile — get keys at https://dash.cloudflare.com/?to=/:account/turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_site_key
TURNSTILE_SECRET_KEY=your_secret_key

# Session signing — generate with: openssl rand -base64 32
SESSION_SECRET=your_random_secret
```

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time (public). The other two are server-only.

## Local Testing Keys

Cloudflare provides test keys that always pass or fail without real verification:

| Scenario | Site Key | Secret Key |
| --- | --- | --- |
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AB` |

Use the "always passes" keys in `.env.local` during development.

## Next Steps

- [API Reference](../02-development/02-api-reference.md)
- [Deployment Guide](../03-deployment/01-deployment-guide.md)
