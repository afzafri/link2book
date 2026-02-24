"use client";

import { useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  async function handleConvert() {
    setError(null);
    setDownloadUrl(null);
    setLoading(true);

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

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

      // Extract filename from Content-Disposition header
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
    </main>
  );
}
