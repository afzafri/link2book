# Browser Scraper

X Article pages are React SPAs. The full article body only renders after JavaScript executes,
so a real headless browser is required. `lib/browser-article.ts` uses Playwright with the
stealth plugin to extract clean semantic HTML.

## Why Playwright

X detects headless browsers and shows a login wall instead of article content.

**Puppeteer + stealth** — works on residential/local IPs, fails on Cloudflare Workers
(datacenter IP gets flagged; no support for `--disable-blink-features=AutomationControlled`).

**Playwright + stealth** — Playwright handles the `AutomationControlled` flag automatically.
X renders the article under a login overlay which is dismissed via `page.evaluate()` after load.
Works on local and self-hosted environments.

**Why Cloudflare Workers fails:**

1. No launch flags — Cloudflare's managed browser doesn't allow custom Chromium launch args.
   Without `--disable-blink-features=AutomationControlled`, JS-level stealth patches are insufficient.
2. Datacenter IP — Cloudflare Workers runs from known datacenter ranges.
   X applies more aggressive bot detection against these IPs.

**Conclusion:** Self-hosting with Playwright on any standard VPS works because the IP is not
specifically flagged and launch flags are fully controllable.

## Scroll Strategy

### Stable-height scrolling

Replaces `setInterval` with a "scroll until stable" loop to handle lazy-loading content:

1. Scroll down by `stepPx` (default 500px).
2. Record `document.documentElement.scrollHeight` after each step.
3. Stop when **both** conditions hold:
   - User is within `nearBottomThresholdPx` (80px) of the bottom, **and**
   - `scrollHeight` has not changed for `stableRounds` (6) consecutive checks.

Parameters:

| Name | Default | Description |
| --- | --- | --- |
| `stepPx` | 500 | Pixels per scroll step |
| `delayMs` | 80 | Delay between steps (ms) |
| `stableRounds` | 6 | Required consecutive stable checks |
| `nearBottomThresholdPx` | 80 | "Near bottom" threshold (px) |
| `maxRounds` | 220 | Safety cap on total rounds |

This handles pages where `scrollHeight` increases during scrolling (IntersectionObserver-based lazy rendering).

## Readiness Conditions

After scrolling completes, the scraper waits for real signals instead of blind timeouts:

| Condition | Selector / Check | Timeout |
| --- | --- | --- |
| Body root present | `[data-testid="twitterArticleRichTextView"]` | 10s |
| Content stable | block count + scrollHeight stable for 6 × 150ms samples | 10s |
| Code blocks populated | all `<code>` elements have non-empty `textContent` | 10s |
| Images loaded | all `<img>` elements report `complete === true` | 10s |
| Final micro-buffer | 200ms fixed delay | — |

Removing the prior blind `waitForTimeout(1500)` reduces variance and eliminates "code blocks empty" failures.

## Content Extraction

### Root selection

`bodyEl = document.querySelector('[data-testid="twitterArticleRichTextView"]')` is used directly
as the content root. Avoids unstable `firstBlock.parentElement` heuristics.

### Block traversal

Uses `querySelectorAll` to gather all block-level candidates in document order:

```text
.longform-unstyled   paragraphs / Draft.js text blocks
h2                   headings
section              code blocks, images, captions
pre                  code (when not inside section)
img                  images (wrapped in <figure>)
ol, ul               lists (with nested sub-list support)
blockquote           multi-paragraph quotes
```

Nested duplicates are filtered: if a candidate's ancestor is already a selected candidate, it is
skipped. This preserves content when X wraps blocks in extra container divs.

### Inline HTML preservation

`getInlineHtml()` recursively traverses inline nodes, preserving:

- `a` — full `href`, recursive inner HTML (captures multiple links per paragraph)
- `strong`, `em`, `b`, `i`, `u` — emphasis
- `code` — inline code
- `sup`, `sub`, `br` — typographic elements
- `span`, `div` wrappers — flattened (children preserved)

Prohibited: using `el.querySelector('a')` as a shortcut. All anchors in a paragraph must appear in the output.

### Transform rules

| Block type | Output |
| --- | --- |
| `.longform-unstyled` | `<p>` per Draft.js sub-block inside |
| `h2` | `<h2>` (used for chapter TOC) |
| `section` with `pre` | all `<pre>` elements in order |
| `section` with images | `<figure><img></figure>` per image |
| `section` captions | `<p>` or `<figcaption>` after figures |
| `ol` / `ul` | full list with nested sub-list support |
| `blockquote` | `<blockquote>` with multiple `<p>` per sub-block |

DOM is not mutated. The transform builds a new `clean` document fragment and returns `clean.innerHTML`.

## Real-time Progress

`page.exposeFunction` bridges Playwright's browser context to Node.js. During the scroll loop,
a progress callback fires every 10 scroll rounds (~800ms), emitting messages like
`Scrolling through article... 45%` as SSE events.

Pass `{ debug: true }` to `fetchArticleWithBrowser()` (or set `DEBUG_SCRAPER=1`) to log:

- rounds scrolled, `lastHeight` / `newHeight`, stable counter
- `blockCount` over time
- number of code blocks and images detected

## Edge Cases Covered

1. Long articles (~10k px) with multiple lazy-loaded chunks
2. Multiple code blocks (Prism.js span tokenization — extracted via `textContent`)
3. Multiple images in a single section
4. Nested lists
5. Multiple links in one paragraph
6. Blockquotes with multiple paragraphs
7. Articles with no code (code wait does not delay)
8. Pages where `scrollHeight` increases mid-scroll

## Next Steps

- [EPUB builder](03-epub-builder.md)
- [API reference](../02-development/02-api-reference.md)
