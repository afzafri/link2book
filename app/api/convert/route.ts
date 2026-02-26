import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { canHandleUrl, parseXArticle } from "@/lib/parsers/x";
import { buildEpub } from "@/lib/builders/epub";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  // CSRF check
  const requestedWith = req.headers.get("x-requested-with");
  if (!requestedWith || requestedWith.toLowerCase() !== "xmlhttprequest") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Session check
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken || !verifySession(sessionToken)) {
    return NextResponse.json(
      { error: "Session expired. Please refresh the page." },
      { status: 401 }
    );
  }

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

  let parsed;
  try {
    parsed = await parseXArticle(url);
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
