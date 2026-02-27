import { createCanvas, loadImage } from "@napi-rs/canvas";

const COVER_W = 600;
const COVER_H = 960;
const H_PAD = 40; // horizontal padding

// ── Text wrapping helper ───────────────────────────────────────────────────────

function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Cover generation ──────────────────────────────────────────────────────────

/**
 * Generate a 600×960 JPEG book cover.
 *
 * Layout:
 *  - If bannerBuffer is provided:  banner fills the top area, then title + author below.
 *  - If no banner: title + author centred in the full canvas.
 */
export async function generateCoverImage(
  title: string,
  author: string,
  bannerBuffer?: ArrayBuffer | null
): Promise<Buffer> {
  const canvas = createCanvas(COVER_W, COVER_H);
  const ctx = canvas.getContext("2d");

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = "#faf8f4";
  ctx.fillRect(0, 0, COVER_W, COVER_H);

  // Subtle top & bottom decorative rule
  ctx.strokeStyle = "#c8b89a";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(H_PAD, 24); ctx.lineTo(COVER_W - H_PAD, 24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(H_PAD, COVER_H - 24); ctx.lineTo(COVER_W - H_PAD, COVER_H - 24); ctx.stroke();

  // ── Banner ──────────────────────────────────────────────────────────────────
  const BANNER_TOP = 52;
  const BANNER_H = 340;
  const BANNER_W = COVER_W - H_PAD * 2;
  let textBlockTop: number;

  if (bannerBuffer) {
    try {
      const img = await loadImage(Buffer.from(bannerBuffer));

      // Scale image to fill banner box (cover-fit, centred)
      const imgAspect = img.width / img.height;
      const boxAspect = BANNER_W / BANNER_H;
      let drawW: number, drawH: number, drawX: number, drawY: number;

      if (imgAspect > boxAspect) {
        drawW = BANNER_W;
        drawH = BANNER_W / imgAspect;
        drawX = H_PAD;
        drawY = BANNER_TOP + (BANNER_H - drawH) / 2;
      } else {
        drawH = BANNER_H;
        drawW = BANNER_H * imgAspect;
        drawX = H_PAD + (BANNER_W - drawW) / 2;
        drawY = BANNER_TOP;
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Thin rule below banner
      const ruleY = BANNER_TOP + BANNER_H + 22;
      ctx.strokeStyle = "#c8b89a";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(H_PAD, ruleY); ctx.lineTo(COVER_W - H_PAD, ruleY); ctx.stroke();

      textBlockTop = ruleY + 36;
    } catch {
      // Banner failed — fall back to no-banner layout
      textBlockTop = COVER_H / 2 - 80;
    }
  } else {
    // No banner: centre the text vertically
    textBlockTop = COVER_H / 2 - 80;
  }

  // ── Title ───────────────────────────────────────────────────────────────────
  const TITLE_FONT_SIZE = 34;
  const TITLE_LINE_H = TITLE_FONT_SIZE * 1.35;
  ctx.font = `bold ${TITLE_FONT_SIZE}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = "#1a1a1a";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const titleLines = wrapText(ctx, title, COVER_W - H_PAD * 2.5);
  let y = textBlockTop;
  for (const line of titleLines) {
    ctx.fillText(line, COVER_W / 2, y);
    y += TITLE_LINE_H;
  }

  // ── Author ──────────────────────────────────────────────────────────────────
  y += 18;
  ctx.font = `italic 20px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = "#6b5f52";
  ctx.fillText(author, COVER_W / 2, y);

  return canvas.toBuffer("image/jpeg");
}
