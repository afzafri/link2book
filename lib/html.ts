/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert raw post text to safe HTML with:
 * - triple backtick code blocks → <pre><code>
 * - single backtick inline code → <code>
 * - newlines → <br/>
 */
export function textToHtml(text: string): string {
  // Split on triple backtick code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  const html = parts
    .map((part) => {
      // Code block
      if (part.startsWith("```") && part.endsWith("```")) {
        const inner = part.slice(3, -3).replace(/^\n/, "");
        return `<pre><code>${escapeHtml(inner)}</code></pre>`;
      }

      // Regular text: handle inline code then newlines
      const escaped = escapeHtml(part);

      // Inline code: `...`
      const withInlineCode = escaped.replace(
        /`([^`]+)`/g,
        (_, code) => `<code>${code}</code>`
      );

      // Newlines → <br/>
      const withBreaks = withInlineCode
        .split("\n")
        .map((line) => line || "&#160;")
        .join("<br/>\n");

      return withBreaks;
    })
    .join("");

  return html;
}
