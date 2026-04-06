/**
 * Tray Icon Generator — creates platform-appropriate tray icons programmatically.
 *
 * macOS: Template images (monochrome with alpha) so the OS auto-adapts for
 *        light/dark menu bars. A small colored dot indicates tracking state.
 * Windows/Linux: Full-color icons — green circle = tracking, gray circle = idle.
 *
 * All icons are generated as nativeImage at startup. No external PNG files needed
 * for tray (the existing tray-icon.png in assets/ is kept as a fallback).
 */
const { nativeImage } = require('electron');

// ── Icon dimensions ──────────────────────────────────────────────────────────
// macOS menu bar: 22x22 (logical) with @2x = 44x44 actual pixels.
// Windows/Linux: 16x16 is standard, but 32x32 looks sharper on HiDPI.
const MAC_SIZE = 44;   // @2x for macOS retina
const OTHER_SIZE = 32;  // Windows/Linux

// ── Color palette ────────────────────────────────────────────────────────────
const COLORS = {
  tracking: { r: 34, g: 197, b: 94 },   // Green (#22c55e)
  idle:     { r: 148, g: 163, b: 184 },  // Slate-400 (#94a3b8)
  white:    { r: 255, g: 255, b: 255 },
  black:    { r: 0, g: 0, b: 0 },
};

/**
 * Draw a filled circle into a raw RGBA buffer.
 * cx, cy = center; r = radius; color = {r,g,b}; alpha = 0-255
 */
function drawCircle(buf, imgSize, cx, cy, r, color, alpha = 255) {
  const rSq = r * r;
  for (let y = 0; y < imgSize; y++) {
    for (let x = 0; x < imgSize; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= rSq) {
        const idx = (y * imgSize + x) * 4;
        // Anti-alias the edge (1px feather)
        const dist = Math.sqrt(distSq);
        const edgeFade = Math.min(1, Math.max(0, r - dist));
        const a = Math.round(alpha * edgeFade);
        // Alpha-composite over existing pixel
        const srcA = a / 255;
        const dstA = buf[idx + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA > 0) {
          buf[idx]     = Math.round((color.r * srcA + buf[idx]     * dstA * (1 - srcA)) / outA);
          buf[idx + 1] = Math.round((color.g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
          buf[idx + 2] = Math.round((color.b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
          buf[idx + 3] = Math.round(outA * 255);
        }
      }
    }
  }
}

/**
 * Draw the letter "T" (for TrackFlow) into the buffer.
 * This draws a simple block-style T shape.
 */
function drawLetterT(buf, imgSize, color, alpha = 255) {
  const margin = Math.round(imgSize * 0.2);
  const thickness = Math.max(2, Math.round(imgSize * 0.18));

  // Horizontal bar of T (top)
  const topY = margin;
  const barHeight = thickness;
  const barLeft = margin;
  const barRight = imgSize - margin;

  for (let y = topY; y < topY + barHeight && y < imgSize; y++) {
    for (let x = barLeft; x < barRight && x < imgSize; x++) {
      const idx = (y * imgSize + x) * 4;
      buf[idx] = color.r;
      buf[idx + 1] = color.g;
      buf[idx + 2] = color.b;
      buf[idx + 3] = alpha;
    }
  }

  // Vertical stem of T (center)
  const stemLeft = Math.round((imgSize - thickness) / 2);
  const stemRight = stemLeft + thickness;
  const stemTop = topY + barHeight;
  const stemBottom = imgSize - margin;

  for (let y = stemTop; y < stemBottom && y < imgSize; y++) {
    for (let x = stemLeft; x < stemRight && x < imgSize; x++) {
      const idx = (y * imgSize + x) * 4;
      buf[idx] = color.r;
      buf[idx + 1] = color.g;
      buf[idx + 2] = color.b;
      buf[idx + 3] = alpha;
    }
  }
}

/**
 * Create a macOS template image.
 * Template images are monochrome (black with alpha). macOS automatically
 * inverts them for dark menu bars. We draw a "T" shape with a small
 * colored status dot in the bottom-right corner.
 *
 * The status dot is NOT part of the template (it uses color), so we
 * composite it after marking as template.
 */
function createMacIcon(tracking) {
  const size = MAC_SIZE;
  const buf = Buffer.alloc(size * size * 4, 0); // Transparent

  // Draw the T letterform in black (template images use black + alpha)
  drawLetterT(buf, size, COLORS.black, 200);

  // Status dot — bottom-right corner, small colored circle
  const dotRadius = Math.round(size * 0.16);
  const dotCx = size - dotRadius - 2;
  const dotCy = size - dotRadius - 2;
  const dotColor = tracking ? COLORS.tracking : COLORS.idle;
  drawCircle(buf, size, dotCx, dotCy, dotRadius, dotColor, 255);

  const img = nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
    scaleFactor: 2.0,
  });
  img.setTemplateImage(true);
  return img;
}

/**
 * Create a Windows/Linux tray icon.
 * Full-color: white "T" on a colored circular background.
 */
function createStandardIcon(tracking) {
  const size = OTHER_SIZE;
  const buf = Buffer.alloc(size * size * 4, 0); // Transparent

  const bgColor = tracking ? COLORS.tracking : COLORS.idle;
  const center = Math.round(size / 2);
  const radius = Math.round(size / 2) - 1;

  // Background circle
  drawCircle(buf, size, center, center, radius, bgColor, 255);

  // White "T" on top
  drawLetterT(buf, size, COLORS.white, 255);

  return nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
  });
}

// ── Icon cache ──────────────────────────────────────────────────────────────
// Icons are generated once at first access and reused. This avoids
// re-allocating RGBA buffers + nativeImage on every tray update.
const _cache = new Map();

/**
 * Warm the icon cache eagerly. Call once after app.whenReady().
 * This ensures both tracking and idle icons are pre-generated
 * so getTrayIcon() is allocation-free during normal operation.
 */
function warmIconCache() {
  getTrayIcon(true);
  getTrayIcon(false);
}

/**
 * Get the appropriate tray icon for the current platform and tracking state.
 * Returns a cached nativeImage — zero allocation after first call per state.
 * @param {boolean} tracking - Whether the timer is currently running
 * @returns {Electron.NativeImage}
 */
function getTrayIcon(tracking) {
  const key = `${process.platform}-${tracking}`;
  if (_cache.has(key)) return _cache.get(key);

  const icon = process.platform === 'darwin'
    ? createMacIcon(tracking)
    : createStandardIcon(tracking);
  _cache.set(key, icon);
  return icon;
}

module.exports = { getTrayIcon, warmIconCache };
