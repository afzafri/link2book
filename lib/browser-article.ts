import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

export interface ArticleContent {
  title: string;
  bodyHtml: string;
  coverImageUrl: string | null;
}

/**
 * Fetch the full X Article content using Playwright + stealth.
 *
 * X article pages are React SPAs — content is only available after JS executes.
 * The stealth plugin bypasses X's bot detection so articles load without auth.
 */
export async function fetchArticleWithBrowser(
  articleUrl: string
): Promise<ArticleContent | null> {
  const isLinux = process.platform === "linux";
  const browser = await chromium.launch({
    headless: true,
    args: [
      ...(isLinux ? ["--single-process"] : []),
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();

    // domcontentloaded fires quickly; then we wait for the article body specifically
    await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for article body — this implicitly covers React hydration
    await page
      .waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 12000 })
      .catch(() => null);

    // Dismiss login overlay (rendered on top of content even without auth)
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="login"], [data-testid="LoginForm"]').forEach(el => el.remove());
      document.querySelectorAll('[aria-modal="true"], [role="dialog"]').forEach(el => el.remove());
    });

    // Scroll through to trigger IntersectionObserver-based lazy rendering (code blocks, images).
    // Faster step + shorter delay keeps this under ~1s for most articles.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const step = 800;
        const delay = 50;
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

    // Wait for code block content to be populated after scroll
    await page
      .waitForFunction(() => {
        const codes = document.querySelectorAll('[data-testid="twitterArticleRichTextView"] code');
        if (codes.length === 0) return true;
        return Array.from(codes).every((c) => (c.textContent ?? "").trim().length > 0);
      }, { timeout: 8000 })
      .catch(() => null);

    const result = await page.evaluate(() => {
      const bodyEl = document.querySelector('[data-testid="twitterArticleRichTextView"]');
      const titleEl = document.querySelector('[data-testid="twitter-article-title"]');

      // Prefer the actual article cover photo over og:image (which is often generic)
      const coverPhotoEl = document.querySelector('[data-testid="tweetPhoto"] img') as HTMLImageElement | null;
      const ogImage = (document.querySelector('meta[property="og:image"]') as HTMLMetaElement)?.content ?? null;
      const coverImageUrl = coverPhotoEl?.src ?? ogImage;

      if (!bodyEl) return { bodyHtml: null, title: null, coverImageUrl };

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
            html += (child as Text).textContent ?? "";
          } else if (child.nodeType === 1) {
            const el = child as Element;
            const tag = el.tagName;
            if (tag === "SPAN" || tag === "DIV") {
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
      const firstBlock = bodyEl.querySelector(".longform-unstyled, h2, section[contenteditable], ol, blockquote");
      const contentRoot = firstBlock?.parentElement ?? bodyEl;

      const clean = document.createElement("div");
      let chIdx = 0;

      for (const el of Array.from(contentRoot.children) as Element[]) {
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

        const h2 = el.tagName === "H2" ? el : el.querySelector("h2");
        if (h2) {
          const text = (h2.textContent ?? "").trim();
          const newH2 = document.createElement("h2");
          newH2.id = `ch-${chIdx++}`;
          newH2.textContent = text;
          clean.appendChild(newH2);
          continue;
        }

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

        if (el.tagName === "BLOCKQUOTE") {
          const bq = document.createElement("blockquote");
          const block = el.querySelector(".public-DraftStyleDefault-block") ?? el;
          bq.innerHTML = getInlineHtml(block).trim();
          clean.appendChild(bq);
          continue;
        }
      }

      bodyEl.innerHTML = clean.innerHTML;

      return {
        bodyHtml: bodyEl.innerHTML,
        title: titleEl?.textContent?.trim() ?? document.title ?? null,
        coverImageUrl,
      };
    });

    console.log("[browser-article] title:", result.title, "bodyHtml length:", result.bodyHtml?.length ?? 0);
    console.log("[browser-article] testIds:", await page.evaluate(() =>
      [...new Set(Array.from(document.querySelectorAll("[data-testid]")).map(e => e.getAttribute("data-testid")).filter(Boolean))]
    ));

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
    await browser.close();
  }
}
