// Canvas rendering helpers for Carousel Studio
// Generates 1000x1000 JPG slides with SRT branding and visual variety

import {
  BRAND,
  type LayoutType,
  type PatternType,
  type GlowType,
  type BarType,
  type DecorType,
} from "@/config/carousel-scripts";

const SIZE = 1000;

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  lineHeight: number
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
  // Guard: if lineHeight is used externally, just return lines
  void lineHeight;
  return lines;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPattern(ctx: CanvasRenderingContext2D, pattern: PatternType) {
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = BRAND.text;
  switch (pattern) {
    case "dots":
      for (let x = 0; x < SIZE; x += 40) {
        for (let y = 0; y < SIZE; y += 40) {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case "grid":
      ctx.lineWidth = 1;
      for (let i = 0; i < SIZE; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(SIZE, i);
        ctx.stroke();
      }
      break;
    case "diagonals":
      ctx.lineWidth = 1;
      for (let i = -SIZE; i < SIZE * 2; i += 60) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + SIZE, SIZE);
        ctx.stroke();
      }
      break;
    case "circles":
      for (let r = 100; r < SIZE; r += 100) {
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case "waves":
      ctx.lineWidth = 1;
      for (let y = 0; y < SIZE; y += 60) {
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += 5) {
          const yy = y + Math.sin(x / 50) * 15;
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
  }
  ctx.globalAlpha = 1;
}

function drawGlow(ctx: CanvasRenderingContext2D, glow: GlowType) {
  let gradient: CanvasGradient;
  switch (glow) {
    case "center":
      gradient = ctx.createRadialGradient(500, 500, 0, 500, 500, 500);
      gradient.addColorStop(0, `${BRAND.accent}30`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      break;
    case "top-right":
      gradient = ctx.createRadialGradient(900, 100, 0, 900, 100, 500);
      gradient.addColorStop(0, `${BRAND.accent}25`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      break;
    case "bottom-left":
      gradient = ctx.createRadialGradient(100, 900, 0, 100, 900, 500);
      gradient.addColorStop(0, `${BRAND.green}20`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      break;
    case "radial":
      gradient = ctx.createRadialGradient(500, 500, 100, 500, 500, 600);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(0.5, `${BRAND.accent}15`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      break;
    case "dual":
      gradient = ctx.createRadialGradient(200, 200, 0, 200, 200, 400);
      gradient.addColorStop(0, `${BRAND.accent}20`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      gradient = ctx.createRadialGradient(800, 800, 0, 800, 800, 400);
      gradient.addColorStop(0, `${BRAND.green}15`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      break;
  }
}

function drawBars(ctx: CanvasRenderingContext2D, bar: BarType) {
  ctx.fillStyle = BRAND.accent;
  const h = 6;
  if (bar === "top" || bar === "both") ctx.fillRect(0, 0, SIZE, h);
  if (bar === "bottom" || bar === "both") ctx.fillRect(0, SIZE - h, SIZE, h);
  if (bar === "left") ctx.fillRect(0, 0, h, SIZE);
  if (bar === "right") ctx.fillRect(SIZE - h, 0, h, SIZE);
}

function drawDecor(ctx: CanvasRenderingContext2D, decor: DecorType) {
  ctx.strokeStyle = BRAND.accent;
  ctx.lineWidth = 2;
  const m = 60;
  const l = 40;
  switch (decor) {
    case "corner-brackets":
      // Top-left
      ctx.beginPath();
      ctx.moveTo(m, m + l);
      ctx.lineTo(m, m);
      ctx.lineTo(m + l, m);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(SIZE - m, SIZE - m - l);
      ctx.lineTo(SIZE - m, SIZE - m);
      ctx.lineTo(SIZE - m - l, SIZE - m);
      ctx.stroke();
      break;
    case "underline":
      ctx.beginPath();
      ctx.moveTo(80, SIZE - 120);
      ctx.lineTo(SIZE - 80, SIZE - 120);
      ctx.stroke();
      break;
    case "box":
      ctx.strokeRect(50, 50, SIZE - 100, SIZE - 100);
      break;
    case "circle-accent":
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.arc(SIZE - 120, 120, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case "slash":
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(SIZE - 150, 80);
      ctx.lineTo(SIZE - 100, 80);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
  }
}

export interface DrawOptions {
  hook: string;
  body: string;
  slideIndex: number;
  totalSlides: number;
  layout: LayoutType;
  pattern: PatternType;
  glow: GlowType;
  bar: BarType;
  decor: DecorType;
}

export function drawCanvas(
  canvas: HTMLCanvasElement,
  options: DrawOptions
): void {
  const { hook, body, slideIndex, totalSlides, layout, pattern, glow, bar, decor } = options;
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Layers
  if (pattern !== "none") drawPattern(ctx, pattern);
  if (glow !== "none") drawGlow(ctx, glow);
  if (bar !== "none") drawBars(ctx, bar);
  if (decor !== "none") drawDecor(ctx, decor);

  // Text positions based on layout
  let hookY: number, bodyY: number, textX: number, maxW: number;
  switch (layout) {
    case "top-left":
      textX = 80;
      hookY = 180;
      bodyY = 340;
      maxW = SIZE - 160;
      break;
    case "bottom-right":
      textX = 120;
      hookY = 450;
      bodyY = 580;
      maxW = SIZE - 200;
      break;
    case "split":
      textX = 80;
      hookY = 200;
      bodyY = 540;
      maxW = SIZE - 160;
      break;
    case "stacked":
      textX = SIZE / 2;
      hookY = 280;
      bodyY = 480;
      maxW = SIZE - 200;
      break;
    default: // centered
      textX = SIZE / 2;
      hookY = 340;
      bodyY = 500;
      maxW = SIZE - 200;
      break;
  }

  const isCenter = layout === "centered" || layout === "stacked";
  ctx.textAlign = isCenter ? "center" : "left";

  // Hook text
  ctx.fillStyle = BRAND.text;
  ctx.font = "bold 48px Arial, sans-serif";
  const hookLines = wrapText(ctx, hook, maxW, 58);
  hookLines.forEach((line, i) => {
    ctx.fillText(line, textX, hookY + i * 58);
  });

  // Body text
  ctx.fillStyle = BRAND.muted;
  ctx.font = "28px Arial, sans-serif";
  const bodyLines = wrapText(ctx, body, maxW, 38);
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, textX, bodyY + i * 38);
  });

  // Slide number
  ctx.textAlign = "right";
  ctx.fillStyle = `${BRAND.text}40`;
  ctx.font = "bold 20px Arial, sans-serif";
  ctx.fillText(`${slideIndex + 1}/${totalSlides}`, SIZE - 50, SIZE - 40);

  // SRT branding
  ctx.textAlign = "left";
  ctx.fillStyle = BRAND.accent;
  ctx.font = "bold 16px Arial, sans-serif";
  ctx.fillText("SRT AGENCY", 50, SIZE - 40);
}

/**
 * Downloads a canvas as a JPG file.
 */
export function downloadSlide(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/jpeg", 0.95);
  link.click();
}
