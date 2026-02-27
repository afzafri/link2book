# EPUB Builder

`lib/builders/epub.ts` is a custom EPUB 3 builder using JSZip and sharp.
It takes `ParsedContent` and returns an EPUB as a `Buffer`.

## EPUB 3 Structure

The builder produces a valid EPUB 3 zip with:

```text
mimetype
META-INF/container.xml
OEBPS/content.opf        - package document (metadata + manifest)
OEBPS/toc.ncx            - NCX navigation (EPUB 2 compatibility)
OEBPS/nav.xhtml          - EPUB 3 navigation document
OEBPS/chapter.xhtml      - article body
OEBPS/cover.xhtml        - cover page
OEBPS/images/            - all embedded images
OEBPS/styles/style.css   - reading stylesheet
```

Output is validated against Apple Books and epub-reader.online.

## Cover Image

The cover image is sourced from the X syndication API (`cover_media.media_info.original_img_url`).

sharp processes it to a portrait book ratio:

- Target size: **600 × 960** px (1:1.6 ratio)
- Strategy: `fit: 'contain'`, `background: white` — letterbox fill, no cropping
- Output format: JPEG

If no cover image is available, a plain white cover is generated with the title and author as text (rendered via `@napi-rs/canvas`).

## Body Images

All images referenced in the article body are downloaded and embedded:

- Converted to JPEG for e-ink reader compatibility
- Resized if wider than 800px (preserving aspect ratio)
- External image URLs are replaced with relative `../images/` paths in the HTML

`sharp` handles format conversion. Failed image downloads are skipped (logged only).

## Chapter TOC

The EPUB navigation document is generated from `<h2>` headings found in the article body.
Each heading becomes a TOC entry linking to its anchor ID in `chapter.xhtml`.

If no headings are found, a single "Article" entry is created.

## CSS Stylesheet

The embedded stylesheet targets readability on e-ink and screen readers:

- Serif body font with comfortable line height
- Sans-serif headings
- Code blocks with border and monospace font (extracts Prism.js-tokenised spans via `textContent`)
- Responsive images (max-width 100%)
- Blockquotes with left border

## Metadata

EPUB metadata is populated from `ParsedContent`:

| Field | Source |
| --- | --- |
| Title | `article.title` from syndication API |
| Author | `user.name (@screen_name)` |
| Language | `en` |
| Date | `created_at` from tweet data |
| Identifier | tweet status ID |

## Filename

Sanitized using `sanitizeFilename()`:

```text
[Article Title] - [Author Name].epub
```

Special characters are replaced with spaces; multiple spaces are collapsed.

## References

- [EPUB-CSS-Editor](https://github.com/Jungliana/EPUB-CSS-Editor) — EPUB CSS reference
- [epub-css-starter-kit](https://github.com/mattharrison/epub-css-starter-kit) — EPUB CSS reference

## Next Steps

- [Getting started](../02-development/01-getting-started.md)
- [API reference](../02-development/02-api-reference.md)
