"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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

// ── Stream event types ─────────────────────────────────────────────────────────
type StreamEvent =
  | { type: "progress"; message: string }
  | { type: "metadata"; title: string; author: string; authorHandle: string; coverImageUrl: string | null; createdAt?: string }
  | { type: "block"; html: string }
  | { type: "complete"; filename: string; epubBase64: string }
  | { type: "error"; message: string };

interface BookData {
  title: string;
  author: string;
  authorHandle: string;
  coverImageUrl: string | null;
  createdAt?: string;
  sourceUrl: string;
  isComplete: boolean;
  filename?: string;
  epubBase64?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [bookData, setBookData] = useState<BookData | null>(null);
  const [revealedBlocks, setRevealedBlocks] = useState<string[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll when new blocks arrive
  useEffect(() => {
    if (contentRef.current && revealedBlocks.length > 0) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [revealedBlocks.length]);

  const handleConvert = useCallback(async () => {
    setError(null);
    setLoading(true);
    setStages([]);
    setBookData(null);
    setRevealedBlocks([]);

    const ready = await ensureSession();
    if (!ready) {
      setError("Security verification failed. Please refresh the page and try again.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/convert-stream", {
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

      // Process SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as StreamEvent;
              handleStreamEvent(event);
            } catch (e) {
              console.error("Failed to parse event:", line, e);
            }
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [url]);

  function handleStreamEvent(event: StreamEvent) {
    switch (event.type) {
      case "progress": {
        const msg = event.message;
        const isScroll = msg.startsWith("Scrolling through article");
        setStages((prev) => {
          if (isScroll && prev.some((s) => s.startsWith("Scrolling through article"))) {
            // Update scroll entry in place instead of appending
            return prev.map((s) => s.startsWith("Scrolling through article") ? msg : s);
          }
          return [...prev, msg];
        });
        break;
      }

      case "metadata":
        setBookData({
          title: decodeHtml(event.title),
          author: decodeHtml(event.author),
          authorHandle: decodeHtml(event.authorHandle),
          coverImageUrl: event.coverImageUrl,
          createdAt: event.createdAt,
          sourceUrl: url,
          isComplete: false,
        });
        break;

      case "block":
        setRevealedBlocks((prev) => [...prev, event.html]);
        break;

      case "complete":
        setLoading(false);
        setBookData((prev) =>
          prev
            ? { ...prev, isComplete: true, filename: event.filename, epubBase64: event.epubBase64 }
            : null
        );
        break;

      case "error":
        setError(event.message);
        setLoading(false);
        break;
    }
  }

  const handleDownload = () => {
    if (!bookData?.epubBase64 || !bookData.filename) return;
    const binary = atob(bookData.epubBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "application/epub+zip" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = bookData.filename;
    a.click();
    URL.revokeObjectURL(dlUrl);
  };

  return (
    <main>
      <h1>Link2Book</h1>
      <p>Turn X Articles into clean, portable EPUB books.</p>

      {/* Input Section */}
      <div className="input-section">
        <input
          type="url"
          placeholder="https://x.com/username/status/1234567890"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <button
          onClick={handleConvert}
          disabled={loading || !url.trim()}
        >
          {loading ? "Converting..." : "Convert to EPUB"}
        </button>
      </div>

      {/* Progress timeline */}
      {stages.length > 0 && (
        <div className="progress-timeline">
          {stages.map((stage, i) => (
            <span key={i} className="timeline-item">
              {i > 0 && <span className="timeline-sep">→</span>}
              <span className={i === stages.length - 1 && loading ? "timeline-step current" : "timeline-step done"}>
                {stage}
              </span>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Book Viewer - Inline */}
      {bookData && (
        <div className="book-viewer">
          <style>{BOOK_STYLES}</style>

          {/* Cover */}
          <div className="book-cover">
            {bookData.coverImageUrl && (
              <div className="cover-container">
                <img src={bookData.coverImageUrl} alt="Cover" className="cover-image" />
              </div>
            )}
            <h1 className="book-title">{bookData.title}</h1>
            <p className="book-author">
              by {bookData.author} (@{bookData.authorHandle})
            </p>
            {bookData.createdAt && (
              <p className="book-date">{new Date(bookData.createdAt).toDateString()}</p>
            )}
          </div>

          {/* Content with progressive reveal */}
          <div className="book-content" ref={contentRef}>
            {revealedBlocks.map((block, idx) => (
              <div
                key={idx}
                className="content-block"
                dangerouslySetInnerHTML={{ __html: block }}
              />
            ))}
            {loading && revealedBlocks.length === 0 && (
              <div className="loading-placeholder">
                <div className="loading-line"></div>
                <div className="loading-line short"></div>
                <div className="loading-line"></div>
              </div>
            )}
          </div>

          {/* Download */}
          {bookData.isComplete && (
            <div className="download-section">
              <button onClick={handleDownload} className="download-btn">
                Download EPUB
              </button>
              {bookData.filename && <span className="filename">{bookData.filename}</span>}
            </div>
          )}
        </div>
      )}

      {/* Invisible Turnstile widget */}
      <div id="cf-turnstile" style={{ display: "none" }} />

      <style>{MAIN_STYLES}</style>
    </main>
  );
}

/** Decode HTML entities that may come pre-encoded from the syndication API. */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const MAIN_STYLES = `
main {
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

p {
  color: #666;
  margin-bottom: 1.5rem;
}

.input-section {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.input-section input {
  flex: 1;
  padding: 0.6rem;
  font-size: 1rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.input-section input:focus {
  outline: none;
  border-color: #0070f3;
}

.input-section button {
  padding: 0.6rem 1.5rem;
  font-size: 1rem;
  background: #0070f3;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.input-section button:hover:not(:disabled) {
  background: #0051cc;
}

.input-section button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.progress-timeline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin-bottom: 1rem;
  min-height: 1.4rem;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.timeline-sep {
  color: #ccc;
  font-size: 0.75rem;
  margin: 0 2px;
}

.timeline-step {
  font-size: 0.8rem;
  white-space: nowrap;
}

.timeline-step.done {
  color: #bbb;
}

.timeline-step.current {
  color: #0070f3;
  font-weight: 500;
}

.error-box {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  color: #c00;
  background: #fee;
  border: 1px solid #c00;
  border-radius: 6px;
}
`;

const BOOK_STYLES = `
.book-viewer {
  margin-top: 2rem;
  background: #faf8f5;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.book-cover {
  text-align: center;
  padding-bottom: 1.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid #e5e5e5;
}

.cover-container {
  width: 200px;
  height: 320px;
  margin: 0 auto 1rem;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cover-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.book-title {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 1.5rem;
  margin: 0 0 0.5rem 0;
  color: #111;
  line-height: 1.3;
}

.book-author {
  font-size: 1rem;
  color: #555;
  margin: 0 0 0.25rem 0;
}

.book-date {
  font-size: 0.875rem;
  color: #888;
  margin: 0;
}

.book-content {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1rem;
  line-height: 1.75;
  color: #1a1a1a;
  max-height: 500px;
  overflow-y: auto;
}

.content-block {
  animation: fadeInUp 0.3s ease-out;
  margin-bottom: 0.5rem;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading-placeholder {
  padding: 1rem 0;
}

.loading-line {
  height: 1rem;
  background: linear-gradient(90deg, #e5e5e5 25%, #f0f0f0 50%, #e5e5e5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 0.75rem;
}

.loading-line.short {
  width: 60%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.book-content h1 {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 1.4rem;
  margin: 1.5rem 0 0.75rem 0;
  color: #111;
}

.book-content h2 {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 1.2rem;
  margin: 1.25rem 0 0.5rem 0;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #ddd;
  color: #111;
}

.book-content h3 {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 1.1rem;
  margin: 1rem 0 0.5rem 0;
  color: #222;
}

.book-content p {
  margin: 0 0 0.75rem 0;
  color: #1a1a1a;
}

.book-content a {
  color: #0066cc;
  text-decoration: none;
}

.book-content a:hover {
  text-decoration: underline;
}

.book-content code {
  font-family: "Courier New", monospace;
  font-size: 0.875rem;
  background: #f0f0f0;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
}

.book-content pre {
  background: #f5f5f5;
  padding: 0.75rem 1rem;
  border-radius: 4px;
  overflow-x: auto;
  border-left: 3px solid #ccc;
  margin: 0.75rem 0;
  font-size: 0.875rem;
}

.book-content pre code {
  background: none;
  padding: 0;
}

.book-content blockquote {
  border-left: 3px solid #bbb;
  padding-left: 0.75rem;
  margin: 0.75rem 0;
  color: #555;
  font-style: italic;
}

.book-content ul, .book-content ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.book-content li {
  margin-bottom: 0.25rem;
}

.book-content figure {
  margin: 1rem 0;
  text-align: center;
}

.book-content figure img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.book-content .meta {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 0.875rem;
  color: #666;
  padding-bottom: 0.75rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid #eee;
}

.download-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 2px solid #e5e5e5;
  text-align: center;
}

.download-btn {
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: none;
  color: #000;
  padding: 0.75rem 2rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: transform 0.2s, box-shadow 0.2s;
}

.download-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(74, 222, 128, 0.3);
}

.filename {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #666;
}
`;
