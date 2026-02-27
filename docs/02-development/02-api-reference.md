# API Reference

Link2Book exposes three API endpoints. All `POST` requests require a valid session cookie
and `X-Requested-With` header. See [API Protection](../04-security/01-api-protection.md) for details.

## POST /api/session

Verifies a Cloudflare Turnstile token and sets a short-lived session cookie.

**Request body:**

```json
{ "token": "<turnstile_token>" }
```

**Response:** `200 OK` — sets `l2b_session` HttpOnly cookie (10 min TTL).

**Error:** `403` if token verification fails.

---

## POST /api/convert

Synchronous conversion. Returns the EPUB file directly.

**Request body:**

```json
{ "url": "https://x.com/Username/status/123456789" }
```

**Response:**

- `Content-Type: application/epub+zip`
- `Content-Disposition: attachment; filename="<title> - <author>.epub"`

**Errors:**

| Status | Reason |
| --- | --- |
| `400` | Invalid or unsupported URL |
| `401` | Missing or expired session cookie |
| `403` | Missing `X-Requested-With` header |
| `500` | Conversion failure |

---

## POST /api/convert-stream

Streaming conversion via Server-Sent Events. Preferred over `/api/convert` — provides live
progress and streams content blocks as they are extracted.

**Request body:**

```json
{ "url": "https://x.com/Username/status/123456789" }
```

**Response:**

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`

### SSE Event Types

| Event | Payload | When |
| --- | --- | --- |
| `progress` | `{ message: string }` | Throughout scraping (scroll %, stage name) |
| `metadata` | `{ title, author, authorHandle, coverImageUrl, createdAt }` | After syndication API returns |
| `block` | `{ html: string }` | One per content block, 40ms gap between each |
| `complete` | `{ filename: string, epubBase64: string }` | After EPUB is built |
| `error` | `{ message: string }` | On any failure |

### Progress message sequence

```text
Loading article page...
Article found, scrolling...
Scrolling through article... 10%
Scrolling through article... 20%
...
Waiting for content to stabilize...
Extracting article content...
Building EPUB...
Complete
```

### Consuming the stream (frontend example)

```typescript
const res = await fetch("/api/convert-stream", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
  body: JSON.stringify({ url }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    // handle event.type: "progress" | "metadata" | "block" | "complete" | "error"
  }
}
```

### EPUB delivery

The final EPUB is base64-encoded in the `complete` event. Decode it client-side:

```typescript
const bytes = Uint8Array.from(atob(epubBase64), (c) => c.charCodeAt(0));
const blob = new Blob([bytes], { type: "application/epub+zip" });
const url = URL.createObjectURL(blob);
```

No separate download request is needed.

## Next Steps

- [API Protection](../04-security/01-api-protection.md)
- [Deployment Guide](../03-deployment/01-deployment-guide.md)
