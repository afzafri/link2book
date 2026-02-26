import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { canHandleUrl, parseXArticle } from "@/lib/parsers/x";
import { buildEpub } from "@/lib/builders/epub";

export async function POST(req: NextRequest) {
  // CSRF check
  const requestedWith = req.headers.get("x-requested-with");
  if (!requestedWith || requestedWith.toLowerCase() !== "xmlhttprequest") {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  // Session check
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken || !verifySession(sessionToken)) {
    return new Response(JSON.stringify({ error: "Session expired" }), { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid 'url' field" }), { status: 400 });
  }

  if (!canHandleUrl(url)) {
    return new Response(
      JSON.stringify({ error: "Unsupported URL. Paste the link of an X Article post." }),
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: { type: string; [key: string]: unknown }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // Step 1: Parse (progress events fired in real-time via onProgress callback)
        const parsed = await parseXArticle(url, {
          onProgress: (msg) => sendEvent({ type: "progress", message: msg }),
        });

        // Step 2: Send metadata
        sendEvent({
          type: "metadata",
          title: parsed.title,
          author: parsed.author,
          authorHandle: parsed.authorHandle,
          coverImageUrl: parsed.images[0] ?? null,
          createdAt: parsed.createdAt,
        });

        // Step 3: Send content blocks one by one with a small delay so each
        // block arrives as a separate SSE event (prevents TCP batching).
        const bodyHtml = parsed.bodyHtml ?? "";
        const blocks = parseBlocks(bodyHtml);
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        for (const block of blocks) {
          sendEvent({ type: "block", html: block });
          await sleep(40);
        }

        // Step 4: Build EPUB
        sendEvent({ type: "progress", message: "Building EPUB..." });
        const result = await buildEpub(parsed);

        // Step 5: Complete
        const epubBase64 = result.buffer.toString("base64");
        sendEvent({
          type: "complete",
          filename: result.filename,
          epubBase64,
        });
      } catch (err) {
        console.error("Streaming error:", err);
        sendEvent({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function parseBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<(h[1-6]|p|pre|blockquote|ul|ol|figure|div)[^>]*>[\s\S]*?<\/\1>/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    blocks.push(match[0]);
  }

  return blocks;
}
