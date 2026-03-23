#!/usr/bin/env node
/**
 * Generate all platform icon files from a single source PNG.
 *
 * Usage:
 *   node scripts/generate-icons.js [source-png]
 *
 * Requirements:
 *   - Source PNG should be at least 1024x1024
 *   - sharp must be installed (it's already a dependency)
 *
 * Outputs:
 *   build/icon.icns    — macOS app icon (via iconutil or png2icns)
 *   build/icon.ico     — Windows app icon
 *   build/icon.png     — Fallback PNG (512x512)
 *   build/icons/        — Linux icon set (16, 32, 48, 64, 128, 256, 512)
 *
 * NOTE: .icns generation requires macOS (iconutil). On other platforms,
 *       electron-builder will auto-convert from the PNG files.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
const buildDir = path.join(__dirname, '..', 'build');
const iconsDir = path.join(buildDir, 'icons');

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('ERROR: sharp is required. Run: npm install');
    process.exit(1);
  }

  const sourcePath = process.argv[2] || path.join(buildDir, 'icon-source.png');
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: Source PNG not found at ${sourcePath}`);
    console.error('Place a 1024x1024 PNG at build/icon-source.png and re-run.');
    process.exit(1);
  }

  // Ensure directories exist
  fs.mkdirSync(iconsDir, { recursive: true });

  console.log(`Generating icons from: ${sourcePath}`);

  // 1. Generate Linux icon PNGs (build/icons/NxN.png)
  for (const size of LINUX_SIZES) {
    const outPath = path.join(iconsDir, `${size}x${size}.png`);
    await sharp(sourcePath).resize(size, size).png().toFile(outPath);
    console.log(`  ✓ ${outPath}`);
  }

  // 2. Generate fallback PNG (512x512)
  const pngPath = path.join(buildDir, 'icon.png');
  await sharp(sourcePath).resize(512, 512).png().toFile(pngPath);
  console.log(`  ✓ ${pngPath}`);

  // 3. Generate .icns (macOS only — requires iconutil)
  if (process.platform === 'darwin') {
    const iconsetDir = path.join(buildDir, 'icon.iconset');
    fs.mkdirSync(iconsetDir, { recursive: true });

    const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of icnsSizes) {
      const name = size === 1024 ? '512x512@2x' : `${size}x${size}`;
      await sharp(sourcePath).resize(size, size).png().toFile(path.join(iconsetDir, `icon_${name}.png`));
      // Also generate @2x variants
      if (size <= 512) {
        const name2x = `${size}x${size}@2x`;
        await sharp(sourcePath).resize(size * 2, size * 2).png().toFile(path.join(iconsetDir, `icon_${name2x}.png`));
      }
    }

    try {
      execSync(`iconutil -c icns -o "${path.join(buildDir, 'icon.icns')}" "${iconsetDir}"`);
      console.log(`  ✓ ${path.join(buildDir, 'icon.icns')}`);
    } catch (e) {
      console.warn('  ⚠ iconutil failed — electron-builder will auto-convert from PNGs');
    }

    // Clean up iconset
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  } else {
    console.log('  ⚠ Skipping .icns (not on macOS) — electron-builder will auto-convert');
  }

  // 4. Generate .ico (Windows)
  // electron-builder can auto-convert PNG → ICO, but for best quality we create it manually
  // ICO format = multiple PNG sizes concatenated
  // For now, copy 256x256 PNG and let electron-builder handle ICO conversion
  const icoSourcePath = path.join(buildDir, 'icon.png');
  if (!fs.existsSync(path.join(buildDir, 'icon.ico'))) {
    console.log('  ⚠ icon.ico not generated (requires png-to-ico or electron-builder auto-convert)');
    console.log('    electron-builder will auto-convert icon.png → icon.ico during build');
  }

  console.log('\nDone! If you see warnings about .icns or .ico, electron-builder will handle them automatically.');
}

main().catch(console.error);
