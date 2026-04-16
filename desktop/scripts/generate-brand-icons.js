#!/usr/bin/env node
/**
 * Generate all TrackFlow branded icons:
 * 1. App icon (1024x1024 source PNG) — clock-arc logo on warm gradient background
 * 2. Tray icons (macOS template + Windows/Linux color) — tracking and idle states
 * 3. Notification icon (128x128)
 * 4. All platform sizes (Linux PNGs, fallback 512px)
 *
 * Uses sharp to render SVG → PNG at exact pixel dimensions.
 * Run: node scripts/generate-brand-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BUILD_DIR = path.join(__dirname, '..', 'build');

// ── TrackFlow Clock-Arc Logo SVG (the brand mark) ─────────────────────────
// This is the same logo used in the marketing site, titlebar, and login screen.
// Viewbox 0 0 512 512 — the clock arc with arrow tip and center dot.
function logoSvg({ strokeColor = '#ffffff', arrowColor = '#06B6D4', dotFill = '#6366F1', dotCenter = '#ffffff', opacity = 1 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <defs>
      <linearGradient id="g1" x1="60" y1="452" x2="452" y2="60" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#4338CA"/>
        <stop offset="45%" stop-color="#6366F1"/>
        <stop offset="100%" stop-color="#06B6D4"/>
      </linearGradient>
      <linearGradient id="g2" x1="256" y1="268" x2="345" y2="148" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#6366F1"/>
        <stop offset="100%" stop-color="#22D3EE"/>
      </linearGradient>
    </defs>
    <g opacity="${opacity}">
      <path d="M 108 362 A 180 180 0 1 1 348 108" stroke="${strokeColor === 'gradient' ? 'url(#g1)' : strokeColor}" stroke-width="48" stroke-linecap="round" fill="none"/>
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="${arrowColor}"/>
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="url(#g1)" opacity="0.25"/>
      <line x1="256" y1="256" x2="330" y2="160" stroke="url(#g2)" stroke-width="28" stroke-linecap="round"/>
      <circle cx="256" cy="256" r="24" fill="${dotFill}"/>
      <circle cx="256" cy="256" r="11" fill="${dotCenter}"/>
    </g>
  </svg>`;
}

// ── App Icon (rounded square with gradient background) ────────────────────
function appIconSvg(size = 1024) {
  const r = Math.round(size * 0.22); // Corner radius
  const pad = Math.round(size * 0.15); // Padding for logo inside
  const logoSize = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="${size}" x2="${size}" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#1a1412"/>
        <stop offset="50%" stop-color="#1c1816"/>
        <stop offset="100%" stop-color="#201a18"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
    <svg x="${pad}" y="${pad}" width="${logoSize}" height="${logoSize}" viewBox="0 0 512 512">
      ${logoSvg({ strokeColor: 'gradient', arrowColor: '#06B6D4', dotFill: '#6366F1', dotCenter: '#ffffff' }).replace(/<\/?svg[^>]*>/g, '')}
    </svg>
  </svg>`;
}

// ── Tray Icon — macOS Template (rounded rect bg + white logo) ─────────────
// Uses a solid rounded rectangle background so the logo is clearly visible
// in both light and dark menu bars. Template-marked so macOS handles contrast.
// Status dot overlays in the bottom-right corner with color.
function trayMacSvg(size = 44, tracking = false) {
  const dotColor = tracking ? '#22c55e' : '#94a3b8';
  const dotR = Math.round(size * 0.13);
  const dotCx = size - dotR - 1;
  const dotCy = size - dotR - 1;
  const bgR = Math.round(size * 0.2); // corner radius
  const logoPad = Math.round(size * 0.17);
  const logoSize = size - logoPad * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${bgR}" ry="${bgR}" fill="#000000" opacity="0.85"/>
    <svg x="${logoPad}" y="${logoPad}" width="${logoSize}" height="${logoSize}" viewBox="0 0 512 512">
      <path d="M 108 362 A 180 180 0 1 1 348 108" stroke="#ffffff" stroke-width="58" stroke-linecap="round" fill="none" opacity="0.95"/>
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="#ffffff" opacity="0.95"/>
      <line x1="256" y1="256" x2="330" y2="160" stroke="#ffffff" stroke-width="34" stroke-linecap="round" opacity="0.95"/>
      <circle cx="256" cy="256" r="28" fill="#ffffff" opacity="0.95"/>
    </svg>
    <circle cx="${dotCx}" cy="${dotCy}" r="${dotR}" fill="${dotColor}"/>
  </svg>`;
}

// ── Tray Icon — Windows/Linux (rounded rect bg + white logo) ──────────────
function trayColorSvg(size = 32, tracking = false) {
  const bgColor = tracking ? '#22c55e' : '#78716c';
  const bgR = Math.round(size * 0.22);
  const logoPad = Math.round(size * 0.18);
  const logoSize = size - logoPad * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${bgR}" ry="${bgR}" fill="${bgColor}"/>
    <svg x="${logoPad}" y="${logoPad}" width="${logoSize}" height="${logoSize}" viewBox="0 0 512 512">
      <path d="M 108 362 A 180 180 0 1 1 348 108" stroke="#ffffff" stroke-width="58" stroke-linecap="round" fill="none"/>
      <path d="M 324 140 L 396 62 L 368 152 Z" fill="#ffffff"/>
      <line x1="256" y1="256" x2="330" y2="160" stroke="#ffffff" stroke-width="34" stroke-linecap="round"/>
      <circle cx="256" cy="256" r="28" fill="#ffffff"/>
    </svg>
  </svg>`;
}

// ── Notification Icon (color logo on transparent) ─────────────────────────
function notificationIconSvg(size = 128) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    ${logoSvg({ strokeColor: 'gradient' }).replace(/<\/?svg[^>]*>/g, '')}
  </svg>`;
}

async function generateAll() {
  console.log('Generating TrackFlow branded icons...\n');

  // Ensure directories exist
  const trayDir = path.join(BUILD_DIR, 'tray');
  const iconsDir = path.join(BUILD_DIR, 'icons');
  fs.mkdirSync(trayDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });

  // 1. App icon source (1024x1024)
  console.log('1. App icon (1024x1024)...');
  await sharp(Buffer.from(appIconSvg(1024))).png().toFile(path.join(BUILD_DIR, 'icon-source.png'));
  console.log('   ✓ build/icon-source.png');

  // 2. App icon 512px fallback
  await sharp(Buffer.from(appIconSvg(1024))).resize(512, 512).png().toFile(path.join(BUILD_DIR, 'icon.png'));
  console.log('   ✓ build/icon.png (512x512)');

  // 3. Linux icon sizes
  console.log('2. Linux icons...');
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    await sharp(Buffer.from(appIconSvg(1024))).resize(size, size).png().toFile(path.join(iconsDir, `${size}x${size}.png`));
    console.log(`   ✓ build/icons/${size}x${size}.png`);
  }

  // 4. macOS tray icons (44px = 22@2x)
  console.log('3. macOS tray icons (template)...');
  await sharp(Buffer.from(trayMacSvg(44, false))).png().toFile(path.join(trayDir, 'tray-idle.png'));
  await sharp(Buffer.from(trayMacSvg(44, true))).png().toFile(path.join(trayDir, 'tray-tracking.png'));
  // Also generate @1x (22px) for non-retina
  await sharp(Buffer.from(trayMacSvg(22, false))).png().toFile(path.join(trayDir, 'tray-idle@1x.png'));
  await sharp(Buffer.from(trayMacSvg(22, true))).png().toFile(path.join(trayDir, 'tray-tracking@1x.png'));
  console.log('   ✓ build/tray/tray-idle.png (44px @2x)');
  console.log('   ✓ build/tray/tray-tracking.png (44px @2x)');

  // 5. Windows/Linux tray icons (32px)
  console.log('4. Windows/Linux tray icons...');
  await sharp(Buffer.from(trayColorSvg(32, false))).png().toFile(path.join(trayDir, 'tray-idle-color.png'));
  await sharp(Buffer.from(trayColorSvg(32, true))).png().toFile(path.join(trayDir, 'tray-tracking-color.png'));
  // Also generate 64px for HiDPI
  await sharp(Buffer.from(trayColorSvg(64, false))).png().toFile(path.join(trayDir, 'tray-idle-color@2x.png'));
  await sharp(Buffer.from(trayColorSvg(64, true))).png().toFile(path.join(trayDir, 'tray-tracking-color@2x.png'));
  console.log('   ✓ build/tray/tray-idle-color.png (32px)');
  console.log('   ✓ build/tray/tray-tracking-color.png (32px)');

  // 6. Notification icon (128px, color on transparent)
  console.log('5. Notification icon...');
  await sharp(Buffer.from(notificationIconSvg(128))).png().toFile(path.join(trayDir, 'notification-icon.png'));
  await sharp(Buffer.from(notificationIconSvg(256))).png().toFile(path.join(trayDir, 'notification-icon@2x.png'));
  console.log('   ✓ build/tray/notification-icon.png (128px)');

  // 7. Generate .icns for macOS (requires iconutil on macOS)
  if (process.platform === 'darwin') {
    console.log('6. macOS .icns...');
    const { execSync } = require('child_process');
    const iconsetDir = path.join(BUILD_DIR, 'icon.iconset');
    fs.mkdirSync(iconsetDir, { recursive: true });

    const icnsSizes = [
      { name: 'icon_16x16.png', size: 16 },
      { name: 'icon_16x16@2x.png', size: 32 },
      { name: 'icon_32x32.png', size: 32 },
      { name: 'icon_32x32@2x.png', size: 64 },
      { name: 'icon_128x128.png', size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png', size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png', size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ];

    for (const { name, size } of icnsSizes) {
      await sharp(Buffer.from(appIconSvg(1024))).resize(size, size).png().toFile(path.join(iconsetDir, name));
    }

    try {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(BUILD_DIR, 'icon.icns')}"`);
      console.log('   ✓ build/icon.icns');
    } catch (e) {
      console.warn('   ⚠ iconutil failed:', e.message);
    }

    // Clean up iconset
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }

  // 7. Generate .ico for Windows
  console.log('7. Windows .ico...');
  try {
    // ICO format: multiple PNG sizes packed together
    // Sharp can't create ICO directly, but we can create individual PNGs
    // and use png-to-ico or just keep the largest size
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoPngs = [];
    for (const size of icoSizes) {
      const buf = await sharp(Buffer.from(appIconSvg(1024))).resize(size, size).png().toBuffer();
      icoPngs.push(buf);
    }

    // Simple ICO file format generator
    const icoBuffer = createIco(icoPngs, icoSizes);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuffer);
    console.log('   ✓ build/icon.ico');
  } catch (e) {
    console.warn('   ⚠ ICO generation failed:', e.message);
  }

  console.log('\n✅ All icons generated!');
}

// Simple ICO file generator from PNG buffers
function createIco(pngBuffers, sizes) {
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = pngBuffers.length;
  const dirSize = headerSize + dirEntrySize * numImages;

  let offset = dirSize;
  const entries = pngBuffers.map((buf, i) => {
    const entry = {
      width: sizes[i] >= 256 ? 0 : sizes[i], // 0 = 256
      height: sizes[i] >= 256 ? 0 : sizes[i],
      size: buf.length,
      offset: offset,
    };
    offset += buf.length;
    return entry;
  });

  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // ICO header
  ico.writeUInt16LE(0, 0);      // Reserved
  ico.writeUInt16LE(1, 2);      // Type: ICO
  ico.writeUInt16LE(numImages, 4); // Count

  // Directory entries
  entries.forEach((entry, i) => {
    const off = headerSize + i * dirEntrySize;
    ico.writeUInt8(entry.width, off);
    ico.writeUInt8(entry.height, off + 1);
    ico.writeUInt8(0, off + 2);     // Color palette
    ico.writeUInt8(0, off + 3);     // Reserved
    ico.writeUInt16LE(1, off + 4);  // Color planes
    ico.writeUInt16LE(32, off + 6); // Bits per pixel
    ico.writeUInt32LE(entry.size, off + 8);
    ico.writeUInt32LE(entry.offset, off + 12);
  });

  // Image data
  pngBuffers.forEach((buf, i) => {
    buf.copy(ico, entries[i].offset);
  });

  return ico;
}

generateAll().catch(e => {
  console.error('Icon generation failed:', e);
  process.exit(1);
});
