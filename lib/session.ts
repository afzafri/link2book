import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "l2b_session";
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

/** Create a signed session token. */
export function signSession(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  const sig = createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify a session token — returns true if signature valid and not expired. */
export function verifySession(token: string): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return false;

    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = createHmac("sha256", getSecret())
      .update(payload)
      .digest("base64url");

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    if (!timingSafeEqual(sigBuf, expBuf)) return false;

    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}
