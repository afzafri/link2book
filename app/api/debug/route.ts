import { NextRequest, NextResponse } from "next/server";
import { randomToken } from "@/lib/utils";

async function getCloudflareEnv(): Promise<{ BROWSER?: unknown; X_AUTH_TOKEN?: string; X_CT0?: string } | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    return ctx.env as { BROWSER?: unknown; X_AUTH_TOKEN?: string; X_CT0?: string };
  } catch (e) {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const log: Record<string, unknown> = {};

  // 1. Check Cloudflare env / browser binding
  const cfEnv = await getCloudflareEnv();
  log.cfEnvAvailable = cfEnv !== null;
  log.browserBindingAvailable = !!(cfEnv?.BROWSER);
  log.browserBindingType = cfEnv?.BROWSER ? typeof cfEnv.BROWSER : "none";
  log.authTokenPresent = !!(cfEnv?.X_AUTH_TOKEN);
  log.ct0Present = !!(cfEnv?.X_CT0);

  if (!url) {
    return NextResponse.json({ error: "Pass ?url=<x_article_url>", log });
  }

  // 2. Extract tweet ID
  const tweetIdMatch = url.match(/\/status\/(\d+)/);
  const tweetId = tweetIdMatch?.[1] ?? null;
  log.tweetId = tweetId;

  if (!tweetId) {
    return NextResponse.json({ error: "Could not extract tweet ID", log });
  }

  // 3. Syndication API raw response
  try {
    const token = randomToken();
    const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`;
    log.syndicationUrl = syndicationUrl;
    const res = await fetch(syndicationUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; link2book-debug/0.1)" },
    });
    log.syndicationStatus = res.status;
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      log.syndicationData = data;

      // Pull out article info
      const article = data.article as Record<string, unknown> | undefined;
      log.hasArticle = !!article;
      if (article) {
        log.articleKeys = Object.keys(article);
        log.articleTitle = article.title;
        log.articlePreviewText = article.preview_text;
        log.articleRestId = article.rest_id;
        const coverMedia = article.cover_media as Record<string, unknown> | undefined;
        log.coverMedia = coverMedia ?? null;
      }
    } else {
      log.syndicationError = await res.text();
    }
  } catch (e) {
    log.syndicationException = String(e);
  }

  // 4. Browser rendering test
  if (cfEnv?.BROWSER) {
    const articleId = (log.syndicationData as Record<string, unknown> | undefined)
      ? ((log.syndicationData as Record<string, unknown>).article as Record<string, unknown> | undefined)?.rest_id as string ?? null
      : null;

    const articleUrl = articleId
      ? `https://x.com/i/article/${articleId}`
      : `https://x.com/i/article/${tweetId}`; // fallback

    log.browserAttemptUrl = articleUrl;

    try {
      const puppeteer = (await import("@cloudflare/puppeteer")).default;
      const browser = await puppeteer.launch(cfEnv.BROWSER as Parameters<typeof puppeteer.launch>[0]);
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Inject auth cookies
      if (cfEnv?.X_AUTH_TOKEN || cfEnv?.X_CT0) {
        const cookies = [];
        if (cfEnv.X_AUTH_TOKEN) cookies.push({ name: "auth_token", value: cfEnv.X_AUTH_TOKEN, domain: ".x.com", path: "/", httpOnly: true, secure: true });
        if (cfEnv.X_CT0) cookies.push({ name: "ct0", value: cfEnv.X_CT0, domain: ".x.com", path: "/", httpOnly: false, secure: true });
        await page.setCookie(...cookies);
        log.cookiesInjected = cookies.map(c => c.name);
      }

      log.browserLaunched = true;

      await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      log.browserNavigated = true;
      log.browserFinalUrl = page.url();

      // Wait for React to hydrate: body must have real children
      await page
        .waitForFunction(() => document.body && document.body.children.length > 2, { timeout: 15000 })
        .catch((e: unknown) => { log.bodyHydrateTimeout = String(e); });

      // Wait for article selector
      await page
        .waitForSelector('[data-testid="twitterArticleRichTextView"]', { timeout: 15000 })
        .catch((e: unknown) => { log.articleSelectorTimeout = String(e); });

      log.browserTitle = await page.title();

      // Dump all testids found on page
      const testIds = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("[data-testid]"));
        return els.map((el) => el.getAttribute("data-testid")).filter(Boolean);
      });
      log.browserTestIds = testIds;

      // Try to get article content — use body not documentElement to skip <head> CSS
      const articleContent = await page.evaluate(() => {
        const body = document.querySelector('[data-testid="twitterArticleRichTextView"]');
        const title = document.querySelector('[data-testid="twitter-article-title"]');
        return {
          bodyHtml: body?.innerHTML?.slice(0, 3000) ?? null,
          titleText: title?.textContent ?? null,
          bodyChildCount: document.body.children.length,
          rawBodySnippet: document.body.innerHTML.slice(0, 5000),
        };
      });
      log.browserArticleContent = articleContent;

      await browser.close();
      log.browserClosed = true;
    } catch (e) {
      log.browserException = String(e);
      log.browserExceptionStack = (e as Error)?.stack?.slice(0, 1000);
    }
  } else {
    log.browserSkipped = "No BROWSER binding — not running on Cloudflare Worker";
  }

  return NextResponse.json(log, { status: 200 });
}
