import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

export interface ArticleContent {
  title: string;
  bodyHtml: string;
  coverImageUrl: string | null;
}

interface FetchOptions {
  debug?: boolean;
}

/**
 * Fetch the full X Article content using Playwright + stealth.
 *
 * X article pages are React SPAs — content is only available after JS executes.
 * The stealth plugin bypasses X's bot detection so articles load without auth.
 */
export async function fetchArticleWithBrowser(
  articleUrl: string,
  opts?: FetchOptions
): Promise<ArticleContent | null> {
  const debug = opts?.debug ?? process.env.DEBUG_SCRAPER === "1";
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

    // FR7 debug: forward browser console logs
    if (debug) {
      page.on("console", (msg) => {
        const text = msg.text();
        if (text.startsWith("[scraper]")) console.log(text);
      });
    }

    // domcontentloaded fires quickly; then we wait for the article body specifically
    await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // FR2.1: Wait for article body — this implicitly covers React hydration
    await page
      .waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 12000 })
      .catch(() => null);

    // Dismiss login overlay (rendered on top of content even without auth)
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="login"], [data-testid="LoginForm"]').forEach(el => el.remove());
      document.querySelectorAll('[aria-modal="true"], [role="dialog"]').forEach(el => el.remove());
    });

    // ── FR1: Stable-height scrolling ──────────────────────────────────────────
    // Scroll until near bottom AND scrollHeight stable for N consecutive rounds.
    // Runs entirely inside page.evaluate (zero CDP round-trips during scroll).
    const scrollStats = await page.evaluate(async (dbg: boolean) => {
      const stepPx = 500;
      const delayMs = 80;
      const stableRounds = 6;
      const nearBottomPx = 80;
      const maxRounds = 220;

      let lastHeight = document.documentElement.scrollHeight;
      let stableCount = 0;
      let rounds = 0;

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      while (rounds < maxRounds) {
        window.scrollBy(0, stepPx);
        await sleep(delayMs);
        rounds++;

        const newHeight = document.documentElement.scrollHeight;
        const nearBottom =
          window.scrollY + window.innerHeight >= newHeight - nearBottomPx;

        if (newHeight !== lastHeight) {
          stableCount = 0;
          lastHeight = newHeight;
        } else if (nearBottom) {
          stableCount++;
          if (stableCount >= stableRounds) break;
        }
      }

      if (dbg) {
        console.log(
          `[scraper] scroll done: rounds=${rounds}, finalHeight=${lastHeight}, stableCount=${stableCount}`
        );
      }

      return { rounds, finalHeight: lastHeight };
    }, debug);

    if (debug) {
      console.log("[browser-article] scroll stats:", scrollStats);
    }

    // ── FR2.2: Content stability (post-scroll) ───────────────────────────────
    await page
      .waitForFunction(
        (dbg: boolean) => {
          const sel =
            ".longform-unstyled, h2, h1, h3, section, pre, img, ol, ul, blockquote";
          const root = document.querySelector(
            '[data-testid="twitterArticleRichTextView"]'
          );
          if (!root) return false;

          const w = window as Window & {
            __stabilityCount?: number;
            __lastBlockCount?: number;
            __lastScrollH?: number;
          };

          const blockCount = root.querySelectorAll(sel).length;
          const scrollH = document.documentElement.scrollHeight;

          if (
            blockCount === w.__lastBlockCount &&
            scrollH === w.__lastScrollH
          ) {
            w.__stabilityCount = (w.__stabilityCount ?? 0) + 1;
          } else {
            w.__stabilityCount = 0;
            w.__lastBlockCount = blockCount;
            w.__lastScrollH = scrollH;
          }

          if (dbg && w.__stabilityCount !== undefined) {
            console.log(
              `[scraper] stability: blocks=${blockCount}, scrollH=${scrollH}, stable=${w.__stabilityCount}`
            );
          }

          return w.__stabilityCount >= 6;
        },
        debug,
        { timeout: 10000, polling: 150 }
      )
      .catch(() => null);

    // FR2.3: Wait for code block content to be populated after scroll
    await page
      .waitForFunction(() => {
        const codes = document.querySelectorAll(
          '[data-testid="twitterArticleRichTextView"] code'
        );
        if (codes.length === 0) return true;
        return Array.from(codes).every(
          (c) => (c.textContent ?? "").trim().length > 0
        );
      }, { timeout: 10000 })
      .catch(() => null);

    // FR2.4: Wait for images to finish loading
    await page
      .waitForFunction(() => {
        const imgs = document.querySelectorAll(
          '[data-testid="twitterArticleRichTextView"] img'
        );
        if (imgs.length === 0) return true;
        return Array.from(imgs).every(
          (img) => (img as HTMLImageElement).complete
        );
      }, { timeout: 10000 })
      .catch(() => null);

    // Micro-buffer (down from 1500ms)
    await page.waitForTimeout(200);

    // ── Extraction ────────────────────────────────────────────────────────────
    const result = await page.evaluate((dbg: boolean) => {
      const bodyEl = document.querySelector(
        '[data-testid="twitterArticleRichTextView"]'
      );
      const titleEl = document.querySelector(
        '[data-testid="twitter-article-title"]'
      );

      // Cover image
      const coverPhotoEl = document.querySelector(
        '[data-testid="tweetPhoto"] img'
      ) as HTMLImageElement | null;
      const ogImage =
        (
          document.querySelector(
            'meta[property="og:image"]'
          ) as HTMLMetaElement
        )?.content ?? null;
      const coverImageUrl = coverPhotoEl?.src ?? ogImage;

      if (!bodyEl) return { bodyHtml: null, title: null, coverImageUrl };

      // ── Pre-pass: fix code blocks ────────────────────────────────────────
      // X.com's Prism.js tokenises code into spans; get plain textContent.
      bodyEl.querySelectorAll("code").forEach((codeEl) => {
        const text = codeEl.textContent ?? "";
        if (text.trim()) {
          codeEl.innerHTML = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }
      });

      // ── FR5: Helpers ─────────────────────────────────────────────────────

      function escHtml(s: string): string {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }

      function escAttr(s: string): string {
        return escHtml(s).replace(/"/g, "&quot;");
      }

      const INLINE_TAGS = new Set([
        "A", "STRONG", "EM", "B", "I", "U", "CODE", "SUP", "SUB", "BR",
      ]);

      /**
       * Extract clean inline HTML from a Draft.js text block.
       * Flattens SPAN/DIV wrappers, preserves allowed inline tags with
       * recursive inner content (no lossy shortcuts).
       */
      function getInlineHtml(node: Node): string {
        let html = "";
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            // Text node
            html += escHtml((child as Text).textContent ?? "");
          } else if (child.nodeType === 1) {
            const el = child as Element;
            const tag = el.tagName;

            if (tag === "BR") {
              html += "<br />";
            } else if (tag === "SPAN" || tag === "DIV") {
              // Flatten wrapper — recurse into children
              html += getInlineHtml(el);
            } else if (tag === "A") {
              const href = (el as HTMLAnchorElement).href;
              const inner = getInlineHtml(el);
              html += `<a href="${escAttr(href)}">${inner}</a>`;
            } else if (INLINE_TAGS.has(tag)) {
              const inner = getInlineHtml(el);
              html += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
            } else {
              // Unknown tag — flatten
              html += getInlineHtml(el);
            }
          }
        }
        return html;
      }

      // ── FR3 + FR4: Content root + block traversal ────────────────────────

      // FR3: Use bodyEl directly as content root (safest)
      const contentRoot = bodyEl;

      // FR4: Gather block candidates in document order
      const candidateSelector =
        ".longform-unstyled, h1, h2, h3, section, pre, img, ol, ul, blockquote";
      const allCandidates = Array.from(
        contentRoot.querySelectorAll(candidateSelector)
      );

      // Build a Set for O(1) lookup during ancestor-filtering
      const candidateSet = new Set(allCandidates);

      // Filter nested duplicates: skip if any ancestor (up to contentRoot)
      // is also a candidate
      const topLevelBlocks: Element[] = [];
      for (const el of allCandidates) {
        let dominated = false;
        let parent = el.parentElement;
        while (parent && parent !== contentRoot) {
          if (candidateSet.has(parent)) {
            dominated = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!dominated) topLevelBlocks.push(el);
      }

      if (dbg) {
        console.log(
          `[scraper] blocks: candidates=${allCandidates.length}, topLevel=${topLevelBlocks.length}`
        );
      }

      // ── FR6: Structural transforms ───────────────────────────────────────

      const clean = document.createElement("div");
      let chIdx = 0;

      /** Helper: extract all Draft.js blocks from a container into <p> tags */
      function extractDraftBlocks(container: Element): HTMLParagraphElement[] {
        const blocks = container.querySelectorAll(
          ".public-DraftStyleDefault-block"
        );
        const ps: HTMLParagraphElement[] = [];
        const targets = blocks.length > 0 ? Array.from(blocks) : [container];
        for (const block of targets) {
          const inlineHtml = getInlineHtml(block).trim();
          if (inlineHtml) {
            const p = document.createElement("p");
            p.innerHTML = inlineHtml;
            ps.push(p);
          }
        }
        return ps;
      }

      /** FR6.4: Build list element recursively (supports nested lists) */
      function buildListElement(srcList: Element): HTMLOListElement | HTMLUListElement {
        const list = document.createElement(
          srcList.tagName.toLowerCase() as "ol" | "ul"
        );
        for (const child of Array.from(srcList.children)) {
          if (child.tagName !== "LI") continue;

          const newLi = document.createElement("li");

          // Check for nested sub-lists
          const nestedLists = child.querySelectorAll(":scope > ol, :scope > ul");

          // Extract inline content from Draft.js blocks in this LI
          const block =
            child.querySelector(".public-DraftStyleDefault-block") ?? child;
          // Only use getInlineHtml if there's no nested list, otherwise extract
          // text content excluding nested list content
          if (nestedLists.length > 0) {
            // Get inline content from direct Draft.js block (before nested list)
            const directBlock = child.querySelector(
              ":scope > .longform-unstyled .public-DraftStyleDefault-block"
            ) ?? child.querySelector(
              ":scope > .public-DraftStyleDefault-block"
            );
            if (directBlock) {
              newLi.innerHTML = getInlineHtml(directBlock).trim();
            } else {
              // Fallback: extract text from non-list children
              for (const liChild of Array.from(child.childNodes)) {
                if (
                  liChild.nodeType === 1 &&
                  ((liChild as Element).tagName === "OL" ||
                    (liChild as Element).tagName === "UL")
                ) {
                  continue; // skip nested lists, handled below
                }
                if (liChild.nodeType === 1) {
                  const inlineHtml = getInlineHtml(liChild).trim();
                  if (inlineHtml) newLi.innerHTML += inlineHtml;
                } else if (liChild.nodeType === 3) {
                  const text = (liChild as Text).textContent?.trim() ?? "";
                  if (text) newLi.innerHTML += escHtml(text);
                }
              }
            }
            // Recurse into nested lists
            for (const nested of Array.from(nestedLists)) {
              newLi.appendChild(buildListElement(nested));
            }
          } else {
            newLi.innerHTML = getInlineHtml(block).trim();
          }

          list.appendChild(newLi);
        }
        return list;
      }

      for (const el of topLevelBlocks) {
        // FR6.1: Paragraphs
        if (el.classList.contains("longform-unstyled")) {
          for (const p of extractDraftBlocks(el)) {
            clean.appendChild(p);
          }
          continue;
        }

        // FR6.2: Headings
        if (el.tagName === "H1" || el.tagName === "H2" || el.tagName === "H3") {
          const text = (el.textContent ?? "").trim();
          if (text) {
            const heading = document.createElement(
              el.tagName.toLowerCase() as "h1" | "h2" | "h3"
            );
            heading.id = `ch-${chIdx++}`;
            heading.textContent = text;
            clean.appendChild(heading);
          }
          continue;
        }

        // FR6.3: Sections — process ALL supported children in DOM order
        if (el.tagName === "SECTION") {
          // Gather all interesting children within the section
          const sectionChildren = el.querySelectorAll(
            "pre, img, .longform-unstyled, .public-DraftStyleDefault-block"
          );
          const processed = new Set<Element>();

          for (const child of Array.from(sectionChildren)) {
            if (processed.has(child)) continue;

            if (child.tagName === "PRE") {
              clean.appendChild(child.cloneNode(true));
              processed.add(child);
            } else if (child.tagName === "IMG") {
              const img = child as HTMLImageElement;
              const figure = document.createElement("figure");
              const imgClone = document.createElement("img");
              imgClone.src = img.src;
              imgClone.alt = img.alt || "";
              figure.appendChild(imgClone);
              clean.appendChild(figure);
              processed.add(child);
            } else if (child.classList.contains("longform-unstyled")) {
              // Caption or text block inside section
              for (const p of extractDraftBlocks(child)) {
                clean.appendChild(p);
              }
              // Mark all Draft.js blocks within as processed
              child
                .querySelectorAll(".public-DraftStyleDefault-block")
                .forEach((b) => processed.add(b));
              processed.add(child);
            } else if (
              child.classList.contains("public-DraftStyleDefault-block")
            ) {
              // Standalone Draft.js block (caption text not inside longform-unstyled)
              if (!processed.has(child)) {
                const inlineHtml = getInlineHtml(child).trim();
                if (inlineHtml) {
                  const p = document.createElement("p");
                  p.innerHTML = inlineHtml;
                  clean.appendChild(p);
                }
                processed.add(child);
              }
            }
          }

          // If section had no recognized children, skip it
          continue;
        }

        // FR6.4: Lists
        if (el.tagName === "OL" || el.tagName === "UL") {
          clean.appendChild(buildListElement(el));
          continue;
        }

        // FR6.5: Blockquotes — multi-paragraph support
        if (el.tagName === "BLOCKQUOTE") {
          const bq = document.createElement("blockquote");
          const ps = extractDraftBlocks(el);
          if (ps.length > 0) {
            for (const p of ps) bq.appendChild(p);
          } else {
            // Fallback: use full inline content
            const inlineHtml = getInlineHtml(el).trim();
            if (inlineHtml) {
              const p = document.createElement("p");
              p.innerHTML = inlineHtml;
              bq.appendChild(p);
            }
          }
          if (bq.childNodes.length > 0) clean.appendChild(bq);
          continue;
        }

        // Fallback: standalone pre not inside section
        if (el.tagName === "PRE") {
          clean.appendChild(el.cloneNode(true));
          continue;
        }

        // Fallback: standalone img not inside section
        if (el.tagName === "IMG") {
          const img = el as HTMLImageElement;
          const figure = document.createElement("figure");
          const imgClone = document.createElement("img");
          imgClone.src = img.src;
          imgClone.alt = img.alt || "";
          figure.appendChild(imgClone);
          clean.appendChild(figure);
          continue;
        }
      }

      // FR7: Return clean.innerHTML directly — do NOT mutate DOM
      return {
        bodyHtml: clean.innerHTML,
        title: titleEl?.textContent?.trim() ?? document.title ?? null,
        coverImageUrl,
      };
    }, debug);

    if (debug) {
      console.log(
        "[browser-article] title:", result.title,
        "bodyHtml length:", result.bodyHtml?.length ?? 0
      );
    }

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
