import { randomToken } from "@/lib/utils";

export interface ParsedContent {
  title: string;
  author: string;
  authorHandle: string;
  text: string;
  bodyHtml?: string;
  createdAt?: string;
  images: string[];
  sourceUrl: string;
  id: string;
}

function extractTweetId(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchSyndication(tweetId: string): Promise<Record<string, unknown>> {
  const token = randomToken();
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`,
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; link2book/0.1)" } }
  );
  if (!res.ok) throw new Error(`Syndication API returned ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export function canHandleUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/.+\/status\/\d+/.test(url);
}

export async function parseXArticle(
  url: string,
  browserBinding?: unknown,
  authToken?: string,
  ct0?: string
): Promise<ParsedContent> {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error(`Could not extract tweet ID from: ${url}`);

  const data = await fetchSyndication(tweetId);

  const article = (data.article as Record<string, unknown>) ?? null;
  if (!article) throw new Error("URL is not an X Article. Paste the status link of an X Article post.");

  const user = (data.user as Record<string, unknown>) ?? {};
  const authorName = (user.name as string) ?? "Unknown Author";
  const authorHandle = (user.screen_name as string) ?? "unknown";
  const createdAt = (data.created_at as string) ?? undefined;

  const title = (article.title as string) ?? "Untitled Article";
  const coverMedia = (article.cover_media as Record<string, unknown>) ?? {};
  const mediaInfo = (coverMedia.media_info as Record<string, unknown>) ?? {};
  const coverImageUrl = (mediaInfo.original_img_url as string) ?? null;
  const articleId = (article.rest_id as string) ?? null;

  const images = coverImageUrl ? [coverImageUrl] : [];

  if (browserBinding && articleId) {
    try {
      const articleUrl = `https://x.com/i/article/${articleId}`;
      const { fetchArticleWithBrowser } = await import("@/lib/browser-article");
      const full = await fetchArticleWithBrowser(articleUrl, browserBinding, authToken, ct0);

      if (full?.bodyHtml) {
        return {
          title: full.title || title,
          author: authorName,
          authorHandle,
          text: title,
          bodyHtml: full.bodyHtml,
          createdAt,
          images, // always use syndication cover — it's the real article cover
          sourceUrl: url,
          id: tweetId,
        };
      }
    } catch (err) {
      console.warn("[xParser] Browser fetch failed:", err);
    }
  }

  throw new Error("Browser rendering unavailable — cannot fetch full article content.");
}
