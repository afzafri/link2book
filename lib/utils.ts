/**
 * Sanitize a string for use as a filename.
 * Removes characters not allowed in filenames and trims whitespace.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // reasonable max length
}

/**
 * Extract the first meaningful line (non-empty) from text.
 */
export function firstMeaningfulLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[0] ?? "Untitled";
}

/**
 * Generate a simple random token (for use in API calls).
 */
export function randomToken(): string {
  return Math.random().toString(36).substring(2, 10);
}
