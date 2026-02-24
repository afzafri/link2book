import JSZip from "jszip";
import sharp from "sharp";
import type { ParsedContent } from "@/lib/parsers/x";
import { sanitizeFilename, firstMeaningfulLine } from "@/lib/utils";

// ── Inline CSS ────────────────────────────────────────────────────────────────

const EPUB_CSS = `
/* ── Reset ──────────────────────────────────────────────────── */
html, body, div, span, h1, h2, h3, h4, h5, h6,
p, blockquote, pre, a, code, em, strong, ol, ul, li,
figure, figcaption, img, section, article {
  margin-right: 0;
  padding: 0;
  border: 0;
  font-size: 100%;
  vertical-align: baseline;
}
table { border-collapse: collapse; border-spacing: 0; }

/* ── Page ────────────────────────────────────────────────────── */
@page { margin-top: 30px; margin-bottom: 20px; }

body {
  font-family: Georgia, "Times New Roman", Caecilia, serif;
  font-size: 1em;
  line-height: 1.7;
  color: #1a1a1a;
}

/* ── Headings ────────────────────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: Helvetica, Arial, sans-serif;
  hyphens: none;
  -webkit-hyphens: none;
  -moz-hyphens: none;
  page-break-after: avoid;
  page-break-inside: avoid;
  text-align: left;
  line-height: 1.25;
  color: #111;
}
h1 { font-size: 1.7em; margin-top: 0; margin-bottom: 0.8em; }
h2 {
  font-size: 1.25em;
  margin-top: 2em;
  margin-bottom: 0.5em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid #ddd;
}
h3 { font-size: 1.05em; margin-top: 1.4em; margin-bottom: 0.4em; }

/* ── Paragraphs ──────────────────────────────────────────────── */
p {
  margin-top: 0;
  margin-bottom: 0.8em;
  text-indent: 0;
  text-align: left;
  orphans: 2;
  widows: 2;
}
h2 + p { margin-top: 0; }

/* ── Lists ───────────────────────────────────────────────────── */
ul, ol {
  margin: 0.6em 0 0.8em 1.6em;
  padding: 0;
  text-align: left;
}
li {
  font-family: Georgia, "Times New Roman", Caecilia, serif;
  line-height: 1.6;
  margin-bottom: 0.25em;
  text-indent: 0;
}

/* ── Blockquote ──────────────────────────────────────────────── */
blockquote {
  margin: 1em 1em 1em 1.2em;
  padding: 0.5em 0 0.5em 1em;
  border-left: 3px solid #bbb;
  font-style: italic;
  color: #444;
}
blockquote p { margin-bottom: 0; text-indent: 0; }

/* ── Code ────────────────────────────────────────────────────── */
pre, code, tt {
  font-family: "Courier New", Courier, monospace;
}
code {
  font-size: 0.875em;
  background: #f0f0f0;
  padding: 0.1em 0.3em;
}
pre {
  font-size: 0.78em;
  line-height: 1.45;
  background: #f5f5f5;
  border-left: 3px solid #ccc;
  padding: 0.9em 1em;
  margin: 1em 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: hidden;
  display: block;
}
pre code { background: none; padding: 0; font-size: 1em; }

/* ── Images ──────────────────────────────────────────────────── */
img {
  max-width: 90%;
  height: auto;
  display: block;
  margin: 0.5em auto;
}
figure {
  margin: 1.5em 0;
  text-align: center;
  page-break-inside: avoid;
}
figure img { margin: 0 auto; }

/* ── Links ───────────────────────────────────────────────────── */
a { color: #0055aa; text-decoration: none; }

/* ── Article meta (author / source line) ────────────────────── */
.meta {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 0.82em;
  color: #666;
  margin-bottom: 2em;
  padding-bottom: 0.8em;
  border-bottom: 2px solid #eee;
}
.meta a { color: #666; }

/* ── Kindle / Mobi overrides ─────────────────────────────────── */
@media amzn-kf8 {
  pre { white-space: pre-wrap; }
}
@media amzn-mobi {
  pre { white-space: pre-wrap; font-size: x-small; margin-left: 1em; }
  blockquote { margin-left: 0; font-style: italic; }
  h2 { font-size: 1em; }
}
`.trim();

// ── Template builders ──────────────────────────────────────────────────────────

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

interface ManifestImage {
  id: string;
  href: string; // relative to OEBPS/
  mime: string;
}

function contentOpf(
  title: string,
  author: string,
  id: string,
  date: string,
  coverImgId: string | null,
  images: ManifestImage[]
): string {
  const manifestImages = images
    .map((img) => `    <item id="${escXml(img.id)}" href="${escXml(img.href)}" media-type="${img.mime}"/>`)
    .join("\n");
  const coverMeta = coverImgId ? `\n    <meta name="cover" content="${escXml(coverImgId)}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escXml(title)}</dc:title>
    <dc:creator>${escXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">${escXml(id)}</dc:identifier>
    <meta property="dcterms:modified">${date}</meta>${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
${manifestImages}
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>`;
}

interface ChapterEntry {
  id: string;    // anchor id, e.g. "ch-0"
  title: string; // plain text heading
}

function tocNcx(bookTitle: string, bookId: string, chapters: ChapterEntry[]): string {
  const navPoints = chapters.length > 0
    ? chapters.map((ch, i) => `    <navPoint id="${escXml(ch.id)}" playOrder="${i + 1}">
      <navLabel><text>${escXml(ch.title)}</text></navLabel>
      <content src="chapter1.xhtml#${escXml(ch.id)}"/>
    </navPoint>`).join("\n")
    : `    <navPoint id="start" playOrder="1">
      <navLabel><text>${escXml(bookTitle)}</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escXml(bookId)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escXml(bookTitle)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function navXhtml(bookTitle: string, chapters: ChapterEntry[]): string {
  const items = chapters.length > 0
    ? chapters.map((ch) => `    <li><a href="chapter1.xhtml#${escXml(ch.id)}">${escXml(ch.title)}</a></li>`).join("\n")
    : `    <li><a href="chapter1.xhtml">${escXml(bookTitle)}</a></li>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

/** Extract chapter entries from sanitized body HTML (h2 elements with id="ch-N"). */
function extractChapters(html: string): ChapterEntry[] {
  const chapters: ChapterEntry[] = [];
  const pattern = /<h2[^>]+\bid="(ch-\d+)"[^>]*>([^<]*)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const title = m[2]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .trim();
    if (title) chapters.push({ id: m[1], title });
  }
  return chapters;
}

function chapterXhtml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── HTML sanitizer ─────────────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": "&#160;", "&mdash;": "&#8212;", "&ndash;": "&#8211;",
  "&ldquo;": "&#8220;", "&rdquo;": "&#8221;", "&lsquo;": "&#8216;", "&rsquo;": "&#8217;",
  "&hellip;": "&#8230;", "&bull;": "&#8226;", "&middot;": "&#183;",
  "&copy;": "&#169;", "&reg;": "&#174;", "&trade;": "&#8482;",
  "&times;": "&#215;", "&divide;": "&#247;", "&euro;": "&#8364;",
  "&pound;": "&#163;", "&yen;": "&#165;", "&cent;": "&#162;",
};

const VOID_ELEMENTS = /(<(?:img|br|hr|input|area|base|col|embed|meta|param|source|track|wbr)(\s[^>]*?)?)(\s*\/?)>/gi;

function sanitizeForXhtml(html: string): string {
  html = html.replace(/\s+style="[^"]*"/gi, "");
  html = html.replace(/\s+data-[\w-]+=(?:"[^"]*"|'[^']*'|\S+)/gi, "");
  html = html.replace(/\s+aria-[\w-]+=(?:"[^"]*"|'[^']*'|\S+)/gi, "");
  html = html.replace(VOID_ELEMENTS, (_, open) => `${open} />`);
  for (const [entity, numeric] of Object.entries(HTML_ENTITIES)) {
    html = html.replaceAll(entity, numeric);
  }
  return html;
}

// ── Image download ─────────────────────────────────────────────────────────────

interface DownloadedImage {
  buffer: ArrayBuffer;
  mime: string;
}

async function downloadImage(url: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";
    return { buffer: await res.arrayBuffer(), mime };
  } catch {
    return null;
  }
}

// Resize cover to portrait book ratio (1:1.6), image centred, white letterbox fill.
async function processCoverImage(buffer: ArrayBuffer): Promise<{ buffer: ArrayBuffer; mime: string }> {
  const W = 600;
  const H = 960; // 1:1.6
  const processed = await sharp(Buffer.from(buffer))
    .resize(W, H, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer: processed.buffer as ArrayBuffer, mime: "image/jpeg" };
}

function mimeToExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EpubResult {
  buffer: Buffer;
  filename: string;
}

export async function buildEpub(content: ParsedContent): Promise<EpubResult> {
  const title = content.title || firstMeaningfulLine(content.text);
  const displayAuthor = `${content.author} (@${content.authorHandle})`;
  const id = `link2book-${content.id}`;
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // Sanitize body HTML for XHTML
  let bodyHtml = content.bodyHtml
    ? sanitizeForXhtml(content.bodyHtml)
    : `<p>${escXml(content.text)}</p>`;

  // Collect all image URLs to embed:
  // 1. Cover from syndication API (content.images[0])
  // 2. All external <img src="https://..."> found in body HTML
  // Collect image URLs to embed.
  // Body HTML from innerHTML has & encoded as &amp; in attribute values — decode before fetching
  // but keep the HTML-encoded form for string replacement in the HTML.
  interface ImgEntry {
    htmlUrl: string;  // as it appears in the HTML string (may contain &amp;)
    fetchUrl: string; // decoded for actual HTTP fetch
    isCover: boolean;
  }

  const entries: ImgEntry[] = [];
  const coverUrl = content.images[0] ?? null;
  if (coverUrl) entries.push({ htmlUrl: coverUrl, fetchUrl: coverUrl, isCover: true });

  const srcPattern = /src="(https?:\/\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = srcPattern.exec(bodyHtml)) !== null) {
    const htmlUrl = m[1];
    const fetchUrl = htmlUrl.replace(/&amp;/g, "&");
    if (!entries.some((e) => e.htmlUrl === htmlUrl)) {
      entries.push({ htmlUrl, fetchUrl, isCover: false });
    }
  }

  // Download all in parallel (best-effort)
  const downloads = await Promise.all(entries.map((e) => downloadImage(e.fetchUrl)));

  // Build manifest entries and rewrite body HTML to use local paths
  const manifestImages: ManifestImage[] = [];
  let coverImgId: string | null = null;
  let bodyImgIdx = 0;
  const imgFolder = new Map<string, { filename: string; buffer: ArrayBuffer }>();

  for (let i = 0; i < entries.length; i++) {
    const dl = downloads[i];
    if (!dl) continue;

    const { htmlUrl, isCover } = entries[i];

    // Process cover into portrait book ratio
    const img = isCover ? await processCoverImage(dl.buffer) : dl;

    const ext = mimeToExt(img.mime);
    const filename = isCover ? `cover.${ext}` : `body${bodyImgIdx++}.${ext}`;
    const href = `images/${filename}`;
    const imgId = isCover ? "cover-img" : `body-img-${bodyImgIdx - 1}`;

    manifestImages.push({ id: imgId, href, mime: img.mime });
    imgFolder.set(filename, { filename, buffer: img.buffer });
    if (isCover) coverImgId = imgId;

    bodyHtml = bodyHtml.replaceAll(`src="${htmlUrl}"`, `src="${href}"`);
  }

  const metaHtml = `<div class="meta">
  <strong>${escXml(content.author)}</strong> (@${escXml(content.authorHandle)})${content.createdAt ? ` &#183; ${new Date(content.createdAt).toDateString()}` : ""}
  <br/><a href="${escXml(content.sourceUrl)}">${escXml(content.sourceUrl)}</a>
</div>`;

  const chapters = extractChapters(bodyHtml);
  const chapterHtml = chapterXhtml(title, `${metaHtml}\n${bodyHtml}`);

  // Build ZIP
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE", createFolders: false });

  const metaInf = zip.folder("META-INF")!;
  metaInf.file("container.xml", containerXml());

  const oebps = zip.folder("OEBPS")!;
  oebps.file("content.opf", contentOpf(title, displayAuthor, id, date, coverImgId, manifestImages));
  oebps.file("toc.ncx", tocNcx(title, id, chapters));
  oebps.file("nav.xhtml", navXhtml(title, chapters));
  oebps.file("style.css", EPUB_CSS);
  oebps.file("chapter1.xhtml", chapterHtml);

  if (imgFolder.size > 0) {
    const images = oebps.folder("images")!;
    for (const { filename, buffer } of imgFolder.values()) {
      images.file(filename, buffer);
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const safeTitle = sanitizeFilename(title);
  const safeAuthor = sanitizeFilename(displayAuthor);
  const filename = `${safeTitle} - ${safeAuthor}.epub`;

  return { buffer: buffer as Buffer, filename };
}
