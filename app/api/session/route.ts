import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function POST(req: NextRequest) {
  let body: { captcha_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { captcha_token } = body;
  if (!captcha_token || typeof captcha_token !== "string") {
    return NextResponse.json({ error: "Missing captcha token" }, { status: 400 });
  }

  const verifyRes = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: captcha_token,
      }),
    }
  );

  const verifyData = (await verifyRes.json()) as TurnstileVerifyResponse;

  if (!verifyData.success) {
    console.warn("[session] Turnstile rejected:", verifyData["error-codes"]);
    return NextResponse.json(
      { error: "Security verification failed. Please refresh and try again." },
      { status: 403 }
    );
  }

  const token = signSession();
  const res = NextResponse.json({ ok: true });

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return res;
}
