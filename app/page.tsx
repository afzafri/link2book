"use client";

import { useState, useEffect, useRef } from "react";

// ── Turnstile types ────────────────────────────────────────────────────────────
interface TurnstileInstance {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  // ── Session / Turnstile ────────────────────────────────────────────────────
  const widgetIdRef = useRef<string | null>(null);
  const sessionOkRef = useRef(false);
  const sessionResolversRef = useRef<Array<(ok: boolean) => void>>([]);

  function resolveSessionWaiters(ok: boolean) {
    sessionOkRef.current = ok;
    const resolvers = sessionResolversRef.current;
    sessionResolversRef.current = [];
    resolvers.forEach((r) => r(ok));
  }

  async function onTurnstileToken(token: string) {
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha_token: token }),
      });
      resolveSessionWaiters(res.ok);
    } catch {
      resolveSessionWaiters(false);
    }
  }

  function onTurnstileExpired() {
    sessionOkRef.current = false;
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }

  function onTurnstileError() {
    resolveSessionWaiters(false);
  }

  useEffect(() => {
    async function init() {
      let attempts = 0;
      while (!window.turnstile && attempts++ < 60) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const container = document.getElementById("cf-turnstile");
      if (!container || !window.turnstile) return;

      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
        callback: onTurnstileToken,
        "expired-callback": onTurnstileExpired,
        "error-callback": onTurnstileError,
      });
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ensureSession(): Promise<boolean> {
    if (sessionOkRef.current) return Promise.resolve(true);
    return new Promise((resolve) => {
      sessionResolversRef.current.push(resolve);
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    });
  }

  async function handleConvert() {
    setError(null);
    setDownloadUrl(null);
    setLoading(true);

    const ready = await ensureSession();
    if (!ready) {
      setError("Security verification failed. Please refresh the page and try again.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ url }),
      });

      if (res.status === 401) {
        sessionOkRef.current = false;
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
        setError("Session expired. Please try again.");
        return;
      }

      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const data = await res.json();
          throw new Error(data.error ?? `Server error ${res.status}`);
        } else {
          const text = await res.text();
          throw new Error(`Server error ${res.status}: ${text.slice(0, 300)}`);
        }
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const name = match ? match[1] : "book.epub";

      setDownloadUrl(objectUrl);
      setFilename(name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Link2Book</h1>
      <p>Turn X Articles into clean, portable EPUB books.</p>

      <div style={{ marginTop: "1.5rem" }}>
        <input
          type="url"
          placeholder="https://x.com/username/status/1234567890"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.5rem",
            fontSize: "1rem",
            boxSizing: "border-box",
            marginBottom: "0.5rem",
          }}
        />
        <button
          onClick={handleConvert}
          disabled={loading || !url.trim()}
          style={{
            padding: "0.5rem 1.5rem",
            fontSize: "1rem",
            cursor: loading || !url.trim() ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Converting…" : "Convert to EPUB"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: "1rem", color: "red", border: "1px solid red", padding: "0.5rem" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {downloadUrl && (
        <div style={{ marginTop: "1rem", border: "1px solid green", padding: "0.75rem" }}>
          <p style={{ margin: 0, color: "green" }}>
            EPUB ready: <strong>{filename}</strong>
          </p>
          <a
            href={downloadUrl}
            download={filename}
            style={{ display: "inline-block", marginTop: "0.5rem", fontSize: "1rem" }}
          >
            Download EPUB
          </a>
        </div>
      )}

      {/* Invisible Turnstile widget — no visible UI */}
      <div id="cf-turnstile" style={{ display: "none" }} />
    </main>
  );
}
