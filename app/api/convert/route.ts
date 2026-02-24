import { NextRequest, NextResponse } from "next/server";
import { canHandleUrl, parseXArticle } from "@/lib/parsers/x";
import { buildEpub } from "@/lib/builders/epub";

async function getCloudflareEnv(): Promise<{ BROWSER?: unknown; X_AUTH_TOKEN?: string; X_CT0?: string } | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    return ctx.env as { BROWSER?: unknown; X_AUTH_TOKEN?: string; X_CT0?: string };
  } catch {
    // Not running on Cloudflare (local dev)
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing or invalid 'url' field" }, { status: 400 });
  }

  if (!canHandleUrl(url)) {
    return NextResponse.json(
      { error: "Unsupported URL. Paste the link of an X Article post." },
      { status: 400 }
    );
  }

  // Get browser binding if running on Cloudflare
  const cfEnv = await getCloudflareEnv();
  const browserBinding = cfEnv?.BROWSER;
  const authToken = cfEnv?.X_AUTH_TOKEN;
  const ct0 = cfEnv?.X_CT0;


  let parsed;
  try {
    parsed = await parseXArticle(url, browserBinding, authToken, ct0);
  } catch (err) {
    console.error("Parser error:", err);
    return NextResponse.json(
      { error: `Failed to fetch article: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  let result;
  try {
    result = await buildEpub(parsed);
  } catch (err) {
    console.error("EPUB build error:", err);
    return NextResponse.json(
      { error: `Failed to build EPUB: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  return new NextResponse(result.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
