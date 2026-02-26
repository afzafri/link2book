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

// Matches https://x.com/Username/article/123 or https://x.com/i/article/123
function extractArticleId(url: string): { articleId: string; username: string } | null {
  const userMatch = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/article\/(\d+)/i);
  if (userMatch) return { username: userMatch[1], articleId: userMatch[2] };
  const iMatch = url.match(/x\.com\/i\/article\/(\d+)/i);
  if (iMatch) return { username: "unknown", articleId: iMatch[1] };
  return null;
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
  return (
    /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/.+\/status\/\d+/.test(url) ||
    /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/.+\/article\/\d+/.test(url) ||
    /^https?:\/\/(www\.)?x\.com\/i\/article\/\d+/.test(url)
  );
}

export async function parseXArticle(
  url: string,
  opts?: { onProgress?: (msg: string) => void }
): Promise<ParsedContent> {
  const { fetchArticleWithBrowser } = await import("@/lib/browser-article");

  // ── Direct article URL (e.g. x.com/User/article/123) ──────────────────────
  const articleInfo = extractArticleId(url);
  console.log("[parser] url:", url);
  console.log("[parser] articleInfo:", articleInfo, "tweetId:", extractTweetId(url));
  if (articleInfo && !extractTweetId(url)) {
    // The article ID in x.com URLs is the tweet/status ID — use it to get real author name
    const syndicationData = await fetchSyndication(articleInfo.articleId).catch(() => null);
    const syndicationUser = (syndicationData?.user as Record<string, unknown>) ?? {};
    const authorName = (syndicationUser.name as string) || articleInfo.username;
    const authorHandle = (syndicationUser.screen_name as string) || articleInfo.username;
    const createdAt = (syndicationData?.created_at as string) ?? undefined;

    // Use user-scoped URL — x.com/i/article/ shows empty state without auth
    const articleUrl = `https://x.com/${articleInfo.username}/article/${articleInfo.articleId}`;
    console.log("[parser] direct article path → navigating to:", articleUrl);
    const full = await fetchArticleWithBrowser(articleUrl, { onProgress: opts?.onProgress });
    console.log("[parser] browser returned bodyHtml length:", full?.bodyHtml?.length ?? 0);
    if (!full?.bodyHtml) throw new Error("Failed to extract article content.");

    return {
      title: full.title || "Article",
      author: authorName,
      authorHandle,
      text: full.title || "Article",
      bodyHtml: full.bodyHtml,
      createdAt,
      images: full.coverImageUrl ? [full.coverImageUrl] : [],
      sourceUrl: url,
      id: articleInfo.articleId,
    };
  }

  // ── Status URL (e.g. x.com/User/status/123) ────────────────────────────────
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error(`Could not extract ID from: ${url}`);

  const data = await fetchSyndication(tweetId);

  const article = (data.article as Record<string, unknown>) ?? null;
  if (!article) throw new Error("URL is not an X Article. Paste the link of an X Article post.");

  const user = (data.user as Record<string, unknown>) ?? {};
  const authorName = (user.name as string) ?? "Unknown Author";
  const authorHandle = (user.screen_name as string) ?? "unknown";
  const createdAt = (data.created_at as string) ?? undefined;

  const title = (article.title as string) ?? "Untitled Article";
  const coverMedia = (article.cover_media as Record<string, unknown>) ?? {};
  const mediaInfo = (coverMedia.media_info as Record<string, unknown>) ?? {};
  const coverImageUrl = (mediaInfo.original_img_url as string) ?? null;
  const syndicationArticleId = (article.rest_id as string) ?? null;

  const images = coverImageUrl ? [coverImageUrl] : [];

  if (syndicationArticleId) {
    try {
      const articleUrl = `https://x.com/${authorHandle}/article/${tweetId}`;
      console.log("[parser] status path → navigating to:", articleUrl);
      const full = await fetchArticleWithBrowser(articleUrl, { onProgress: opts?.onProgress });
      console.log("[parser] browser returned bodyHtml length:", full?.bodyHtml?.length ?? 0);

      if (full?.bodyHtml) {
        return {
          title: full.title || title,
          author: authorName,
          authorHandle,
          text: title,
          bodyHtml: full.bodyHtml,
          createdAt,
          images,
          sourceUrl: url,
          id: tweetId,
        };
      }
    } catch (err) {
      console.warn("[xParser] Browser fetch failed:", err);
    }
  }

  throw new Error("Failed to extract article content.");
}
