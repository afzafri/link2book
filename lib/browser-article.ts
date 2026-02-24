import puppeteer from "@cloudflare/puppeteer";

export interface ArticleContent {
  title: string;
  bodyHtml: string;
  coverImageUrl: string | null;
}

/**
 * Fetch the full X Article content using Cloudflare Browser Rendering.
 * The browser binding (env.BROWSER) must be configured in wrangler.toml.
 *
 * X article pages are React SPAs — content is only available after JS executes.
 * A headless browser is the only way to get the full article body server-side.
 */
export async function fetchArticleWithBrowser(
  articleUrl: string,
  browserBinding: unknown,
  authToken?: string,
  ct0?: string
): Promise<ArticleContent | null> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(browserBinding as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Inject X.com auth cookies so we can access gated article content
    if (authToken || ct0) {
      const cookies = [];
      if (authToken) cookies.push({ name: "auth_token", value: authToken, domain: ".x.com", path: "/", httpOnly: true, secure: true });
      if (ct0) cookies.push({ name: "ct0", value: ct0, domain: ".x.com", path: "/", httpOnly: false, secure: true });
      await page.setCookie(...cookies);
    }

    // domcontentloaded fires quickly; then we wait for React to hydrate the DOM
    await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for any app content to render (React SPA needs time after scripts run)
    await page
      .waitForFunction(() => document.body && document.body.children.length > 2, { timeout: 15000 })
      .catch(() => null);

    // Wait for article body
    await page
      .waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 15000 })
      .catch(() => null);

    // Scroll through the entire page to trigger IntersectionObserver-based lazy rendering.
    // X.com only renders code blocks (and other content) when they enter the viewport.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const step = 400;
        const delay = 120;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, delay);
      });
    });

    // After scrolling, wait for code block content to be populated
    await page
      .waitForFunction(() => {
        const codes = document.querySelectorAll('[data-testid="twitterArticleRichTextView"] code');
        if (codes.length === 0) return true;
        return Array.from(codes).every((c) => (c.textContent ?? "").trim().length > 0);
      }, { timeout: 10000 })
      .catch(() => null);

    const result = await page.evaluate(() => {
      const bodyEl = document.querySelector('[data-testid="twitterArticleRichTextView"]');
      const titleEl = document.querySelector('[data-testid="twitter-article-title"]');
      const ogImage = (document.querySelector('meta[property="og:image"]') as HTMLMetaElement)?.content ?? null;

      if (!bodyEl) return { bodyHtml: null, title: null, coverImageUrl: ogImage };

      // ── Pre-pass: fix code blocks before structural transform ──────────────────
      // X.com's Prism.js tokenises code into spans; get plain textContent instead.
      bodyEl.querySelectorAll("code").forEach((codeEl) => {
        const text = codeEl.textContent ?? "";
        if (text.trim()) {
          codeEl.innerHTML = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }
      });

      // ── Helpers ────────────────────────────────────────────────────────────────

      // Extract clean inline HTML from a Draft.js text block.
      // Unwraps <span><span> nesting, preserves <a>, <strong>, <em>, <code>.
      function getInlineHtml(node: Node): string {
        let html = "";
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            // plain text node
            html += (child as Text).textContent ?? "";
          } else if (child.nodeType === 1) {
            const el = child as Element;
            const tag = el.tagName;
            if (tag === "SPAN" || tag === "DIV") {
              // Check if this div/span is a link wrapper (X.com puts <a> inside <div>)
              const a = el.querySelector("a");
              if (tag === "DIV" && a) {
                const clean = document.createElement("a");
                clean.href = a.href;
                clean.textContent = a.textContent;
                html += clean.outerHTML;
              } else {
                html += getInlineHtml(el);
              }
            } else if (["A","STRONG","EM","B","I","U","CODE","SUP","SUB"].includes(tag)) {
              if (tag === "A") {
                const clean = document.createElement("a");
                clean.href = (el as HTMLAnchorElement).href;
                clean.textContent = el.textContent;
                html += clean.outerHTML;
              } else {
                const clean = document.createElement(tag.toLowerCase());
                clean.innerHTML = getInlineHtml(el);
                html += clean.outerHTML;
              }
            } else {
              html += getInlineHtml(el);
            }
          }
        }
        return html;
      }

      // ── Structural transform ───────────────────────────────────────────────────
      // The actual content blocks are NOT direct children of twitterArticleRichTextView.
      // They are nested inside: div > DraftEditor-root > DraftEditor-editorContainer >
      // public-DraftEditor-content > div > [content blocks].
      // Find the nearest ancestor whose direct children include longform-unstyled divs.
      const firstBlock = bodyEl.querySelector(".longform-unstyled, h2, section[contenteditable], ol, blockquote");
      const contentRoot = firstBlock?.parentElement ?? bodyEl;

      const clean = document.createElement("div");
      let chIdx = 0;

      for (const el of Array.from(contentRoot.children) as Element[]) {
        // ── Plain paragraph ────────────────────────────────────────────────────
        if (el.classList.contains("longform-unstyled")) {
          const block = el.querySelector(".public-DraftStyleDefault-block") ?? el;
          const inlineHtml = getInlineHtml(block).trim();
          if (inlineHtml) {
            const p = document.createElement("p");
            p.innerHTML = inlineHtml;
            clean.appendChild(p);
          }
          continue;
        }

        // ── H2 heading (inside a div wrapper) ─────────────────────────────────
        const h2 = el.tagName === "H2" ? el : el.querySelector("h2");
        if (h2) {
          const text = (h2.textContent ?? "").trim();
          const newH2 = document.createElement("h2");
          newH2.id = `ch-${chIdx++}`;
          newH2.textContent = text;
          clean.appendChild(newH2);
          continue;
        }

        // ── Code block or image (inside <section contenteditable>) ─────────────
        if (el.tagName === "SECTION") {
          const pre = el.querySelector("pre");
          if (pre) {
            clean.appendChild(pre.cloneNode(true));
            continue;
          }
          const img = el.querySelector("img");
          if (img) {
            const figure = document.createElement("figure");
            const imgClone = document.createElement("img");
            imgClone.src = (img as HTMLImageElement).src;
            imgClone.alt = (img as HTMLImageElement).alt || "";
            figure.appendChild(imgClone);
            clean.appendChild(figure);
          }
          continue;
        }

        // ── Ordered / unordered list ───────────────────────────────────────────
        if (el.tagName === "OL" || el.tagName === "UL") {
          const list = document.createElement(el.tagName);
          for (const li of Array.from(el.children) as Element[]) {
            if (li.tagName !== "LI") continue;
            const newLi = document.createElement("li");
            const block = li.querySelector(".public-DraftStyleDefault-block") ?? li;
            newLi.innerHTML = getInlineHtml(block).trim();
            list.appendChild(newLi);
          }
          clean.appendChild(list);
          continue;
        }

        // ── Blockquote ─────────────────────────────────────────────────────────
        if (el.tagName === "BLOCKQUOTE") {
          const bq = document.createElement("blockquote");
          const block = el.querySelector(".public-DraftStyleDefault-block") ?? el;
          bq.innerHTML = getInlineHtml(block).trim();
          clean.appendChild(bq);
          continue;
        }

        // ── Fallback: unknown element, skip silently ───────────────────────────
      }

      bodyEl.innerHTML = clean.innerHTML;

      return {
        bodyHtml: bodyEl.innerHTML,
        title: titleEl?.textContent?.trim() ?? document.title ?? null,
        coverImageUrl: ogImage,
      };
    });

    if (!result.bodyHtml) return null;

    return {
      title: result.title ?? "Article",
      bodyHtml: result.bodyHtml,
      coverImageUrl: result.coverImageUrl,
    };
  } catch (err) {
    console.error("[browser-article] Failed:", err);
    return null;
  } finally {
    await browser?.close();
  }
}
