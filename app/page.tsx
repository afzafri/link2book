"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BookOpen, Link as LinkIcon, Download, ArrowRight, AlertCircle, Loader2, ChevronLeft, ChevronRight, CheckCircle2, Library, BookMarked, Quote } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
  | { type: "complete"; filename: string; epubBase64: string; coverBase64: string }
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
  const [currentPage, setCurrentPage] = useState(0);

  // Split blocks into pages, fixed block count per page
  const BLOCKS_PER_PAGE = 10;
  const pages = useMemo(() => {
    const result: string[][] = [];
    for (let i = 0; i < revealedBlocks.length; i += BLOCKS_PER_PAGE) {
      result.push(revealedBlocks.slice(i, i + BLOCKS_PER_PAGE));
    }
    return result;
  }, [revealedBlocks]);

  // While streaming, always follow the last page so user watches it fill
  useEffect(() => {
    if (loading && pages.length > 0) setCurrentPage(pages.length - 1);
  }, [pages.length, loading]);

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
      setTimeout(() => {
        const idx = sessionResolversRef.current.indexOf(resolve);
        if (idx !== -1) {
          sessionResolversRef.current.splice(idx, 1);
          resolve(false);
        }
      }, 12000);
    });
  }

  const handleConvert = useCallback(async () => {
    setError(null);
    setLoading(true);
    setStages([]);
    setBookData(null);
    setRevealedBlocks([]);
    setCurrentPage(0);

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
        setLoading(false);
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
        setCurrentPage(0);
        setStages((prev) => [...prev, "Complete"]);
        setBookData((prev) =>
          prev
            ? { ...prev, isComplete: true, filename: event.filename, epubBase64: event.epubBase64, coverImageUrl: event.coverBase64 }
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
    <div className="min-h-screen bg-[#fdfaf6] selection:bg-emerald-100 selection:text-emerald-900 font-sans flex flex-col text-stone-800">
      {/* Header */}
      <header className="px-6 py-8 max-w-5xl mx-auto w-full flex items-center justify-between border-b border-stone-200/50">
        <div className="flex items-center gap-3 font-serif font-bold text-2xl text-stone-900 tracking-tight">
          <div className="w-9 h-9 bg-stone-900 text-[#fdfaf6] rounded flex items-center justify-center shadow-sm">
            <Library className="w-5 h-5" />
          </div>
          Link2Book
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-stone-400 uppercase tracking-widest">Est. 2026</span>
          <a
            href="https://github.com/afzafri/link2book"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-400 hover:text-gray-900 transition-colors"
            title="View on GitHub"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 pt-16 pb-24">
        <div className="text-center mb-14">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-stone-200 bg-white/60 text-stone-600 text-xs font-semibold uppercase tracking-widest mb-8 shadow-sm backdrop-blur-sm"
          >
            <BookMarked className="w-3.5 h-3.5 text-emerald-700" />
            Currently supporting X Articles
          </motion.div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-serif text-stone-900 mb-6 leading-[1.1] tracking-tight">
            Curate the web into <br className="hidden sm:block" />
            <span className="italic text-emerald-800">your personal library.</span>
          </h1>
          <p className="text-lg sm:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-light">
            Transform long-form articles into beautiful, distraction-free EPUB files. Build an archive of knowledge for your e-reader.
          </p>
        </div>

        {/* Input Form */}
        <div className="max-w-2xl mx-auto bg-white p-2.5 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-stone-200 mb-12 flex flex-col sm:flex-row gap-2 transition-all focus-within:ring-4 focus-within:ring-emerald-500/10 focus-within:border-emerald-600 relative z-20">
          <div className="flex-1 flex items-center px-4">
            <LinkIcon className="w-5 h-5 text-stone-400 shrink-0 mr-3" />
            <input
              type="url"
              placeholder="Paste an article URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              className="w-full py-3 bg-transparent text-stone-900 placeholder:text-stone-400 focus:outline-none text-base sm:text-lg font-medium"
            />
          </div>
          <button
            onClick={handleConvert}
            disabled={loading || !url.trim()}
            className="flex items-center justify-center gap-2 bg-stone-900 hover:bg-stone-800 text-[#fdfaf6] px-8 py-3.5 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-stone-900 shadow-sm active:scale-[0.98] sm:w-auto w-full group"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-stone-300" />
                Converting
              </>
            ) : (
              <>
                Create Book
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </div>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="max-w-2xl mx-auto mb-8 overflow-hidden"
            >
              <div className="flex items-start gap-3 bg-red-50 p-4 border border-red-200 rounded-xl text-red-800 mt-2">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <h4 className="font-semibold text-sm">Failed to process article</h4>
                  <p className="text-sm mt-1 text-red-700/90 leading-relaxed">{error}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress Pipeline */}
        {stages.length > 0 && !bookData?.isComplete && (
          <div className="max-w-2xl mx-auto mb-10">
            <div className="bg-[#f2efe9] rounded-2xl p-6 sm:p-8 border border-stone-200/60 shadow-inner">
              <h3 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-6 flex items-center gap-2">
                <Quote className="w-3 h-3" /> Conversion Progress
              </h3>
              <div className="space-y-5">
                {stages.map((stage, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i} 
                    className="flex items-start gap-3"
                  >
                    {i === stages.length - 1 && loading ? (
                      <Loader2 className="w-5 h-5 text-emerald-700 animate-spin shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-stone-400 shrink-0 mt-0.5" />
                    )}
                    <span className={cn(
                      "text-sm font-medium leading-relaxed",
                      i === stages.length - 1 && loading ? "text-stone-900" : "text-stone-500"
                    )}>
                      {stage}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Book Result */}
        {bookData && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden mt-12"
          >
            {/* Book Meta Header */}
            <div className="p-8 sm:p-10 border-b border-stone-100 bg-[#fbf9f4] flex flex-col sm:flex-row gap-8 sm:items-start relative overflow-hidden">
              <div className="absolute right-0 top-0 w-64 h-64 bg-stone-200/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
              
              {bookData.coverImageUrl ? (
                <div className="w-36 h-52 shrink-0 bg-white shadow-md border border-stone-200 flex items-center justify-center p-1.5 relative z-10">
                  <img src={bookData.coverImageUrl} alt="Cover" className="max-w-full max-h-full object-contain" />
                </div>
              ) : (
                <div className="w-36 h-52 shrink-0 bg-stone-100 shadow-inner border border-stone-200 flex items-center justify-center text-stone-300 relative z-10">
                  <Library className="w-12 h-12 opacity-50" />
                </div>
              )}
              
              <div className="flex-1 pt-2 relative z-10">
                <div className="mb-4">
                  <h2 className="text-3xl sm:text-4xl font-serif font-bold text-stone-900 leading-[1.15] mb-3">
                    {bookData.title}
                  </h2>
                  <p className="text-lg font-serif text-stone-700 italic">
                    By {bookData.author} <span className="text-stone-400 not-italic text-base ml-1">(@{bookData.authorHandle})</span>
                  </p>
                  {bookData.createdAt && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mt-4">
                      Published {new Date(bookData.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  )}
                </div>

                {bookData.isComplete && (
                  <div className="mt-8">
                    <button
                      onClick={handleDownload}
                      className="inline-flex items-center gap-2 bg-stone-900 hover:bg-stone-800 text-[#fdfaf6] px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95"
                    >
                      <Download className="w-4 h-4" />
                      Download EPUB
                    </button>
                    {bookData.filename && (
                      <p className="text-xs text-stone-400 mt-3 font-mono">{bookData.filename}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Paged Content Preview */}
            <div className="p-8 sm:p-10 bg-white">
              <div className="flex items-center justify-between mb-8 pb-4 border-b-2 border-stone-100">
                <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Reading Preview
                </h3>
                {pages.length > 0 && (
                  <div className="flex items-center gap-3 text-sm text-stone-500">
                    <button
                      onClick={() => setCurrentPage((p) => p - 1)}
                      disabled={currentPage === 0}
                      className="p-1 hover:text-stone-900 disabled:opacity-30 disabled:hover:text-stone-500 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="font-serif italic text-stone-600">
                      Page {currentPage + 1} of {pages.length}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => p + 1)}
                      disabled={currentPage >= pages.length - 1}
                      className="p-1 hover:text-stone-900 disabled:opacity-30 disabled:hover:text-stone-500 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="prose prose-stone max-w-none font-serif text-lg leading-relaxed text-stone-800 h-[650px] overflow-y-auto pr-6 scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent">
                {pages[currentPage]?.map((block, idx) => (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={`${currentPage}-${idx}`}
                    className="mb-6"
                    dangerouslySetInnerHTML={{ __html: block }}
                  />
                ))}

                {loading && revealedBlocks.length === 0 && (
                  <div className="animate-pulse space-y-6 opacity-60">
                    <div className="h-4 bg-stone-200 rounded w-3/4"></div>
                    <div className="h-4 bg-stone-200 rounded w-full"></div>
                    <div className="h-4 bg-stone-200 rounded w-5/6"></div>
                    <div className="h-4 bg-stone-200 rounded w-full"></div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Typographic Feature Grid (Replaces standard SaaS columns) */}
        {!bookData && !loading && (
          <div className="grid sm:grid-cols-3 gap-10 mt-24 pt-16 border-t border-stone-200/80">
             <div className="relative">
               <span className="absolute -top-10 left-0 text-6xl font-serif text-stone-200/50 font-bold -z-10 select-none">01</span>
               <h3 className="text-xl font-serif text-stone-900 mb-3 tracking-tight">Focused Reading</h3>
               <p className="text-sm text-stone-600 leading-relaxed">
                 Strips away the noise of modern interfaces—no ads, no sidebars, no metrics. Just pure text and essential media.
               </p>
             </div>

             <div className="relative">
               <span className="absolute -top-10 left-0 text-6xl font-serif text-stone-200/50 font-bold -z-10 select-none">02</span>
               <h3 className="text-xl font-serif text-stone-900 mb-3 tracking-tight">Native Formats</h3>
               <p className="text-sm text-stone-600 leading-relaxed">
                 Creates rigorously structured EPUBs with embedded metadata, compatible with Apple Books, Kindle, and dedicated e-ink devices.
               </p>
             </div>

             <div className="relative">
               <span className="absolute -top-10 left-0 text-6xl font-serif text-stone-200/50 font-bold -z-10 select-none">03</span>
               <h3 className="text-xl font-serif text-stone-900 mb-3 tracking-tight">Offline Archive</h3>
               <p className="text-sm text-stone-600 leading-relaxed">
                 Downloads high-resolution images and essential assets directly into the manuscript, ensuring your library remains intact forever.
               </p>
             </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto py-10 bg-[#f5f3ec] border-t border-stone-200 text-stone-500">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-serif text-stone-700 font-semibold">
            <Library className="w-4 h-4" />
            <span>Link2Book</span>
          </div>
          <p className="text-sm font-medium">
            &copy; {new Date().getFullYear()} &middot; Curate wisely.
          </p>
        </div>
      </footer>

      {/* Invisible Turnstile widget */}
      <div id="cf-turnstile" style={{ display: "none" }} />
    </div>
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
