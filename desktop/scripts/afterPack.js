const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function stripPlistKeys(xml, keys) {
  let out = xml;
  for (const key of keys) {
    const re = new RegExp(`<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`, 'g');
    out = out.replace(re, '');
  }
  out = out.replace(/\n\s*\n\s*\n/g, '\n\n');
  return out;
}

function signOne(targetPath) {
  try {
    execSync(`codesign --force --sign - "${targetPath}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');

  if (!fs.existsSync(plistPath)) return;

  const original = fs.readFileSync(plistPath, 'utf8');

  // 1. Strip unused permission descriptions
  let cleaned = stripPlistKeys(original, [
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
  ]);

  // 2. Fix bundle identifier
  if (cleaned.includes('<string>Electron</string>') && cleaned.includes('CFBundleIdentifier')) {
    cleaned = cleaned.replace(
      /<key>CFBundleIdentifier<\/key>\s*<string>Electron<\/string>/,
      '<key>CFBundleIdentifier</key><string>com.trackflow.agent</string>'
    );
    console.log('  • afterPack: fixed CFBundleIdentifier');
  }

  if (cleaned !== original) {
    fs.writeFileSync(plistPath, cleaned, 'utf8');
    console.log('  • afterPack: cleaned Info.plist');
  }

  // 3. Ad-hoc sign INSIDE-OUT (required order for macOS codesign)
  //
  //    macOS codesign is strict: every nested code object must be signed
  //    BEFORE its parent. The order for Electron apps is:
  //
  //      a) Helpers inside Electron Framework (chrome_crashpad_handler)
  //      b) .dylib files inside Electron Framework/Libraries/
  //      c) Electron Framework binary itself
  //      d) Electron Framework.framework bundle
  //      e) Helper .app bundles (GPU, Plugin, Renderer, etc.)
  //      f) The main .app bundle (with entitlements)
  //
  //    Using --deep is deprecated and FAILS on cross-compiled x64 builds.
  const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  if (!fs.existsSync(entitlementsPath)) return;

  try {
    console.log('  • afterPack: ad-hoc signing with entitlements...');
    let signed = 0;

    const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');

    // Sign ALL .framework bundles (Electron Framework, Squirrel, Mantle, ReactiveObjC)
    // Each framework may have: Versions/A/{binary, Helpers/*, Libraries/*.dylib}
    if (fs.existsSync(frameworksDir)) {
      for (const entry of fs.readdirSync(frameworksDir)) {
        if (!entry.endsWith('.framework')) continue;
        const fwPath = path.join(frameworksDir, entry);
        const fwName = entry.replace('.framework', '');

        // Try Versions/A structure (Electron Framework uses this)
        const versionDir = path.join(fwPath, 'Versions', 'A');
        const searchDir = fs.existsSync(versionDir) ? versionDir : fwPath;

        // a) Sign Helpers (e.g., chrome_crashpad_handler)
        const helpersDir = path.join(searchDir, 'Helpers');
        if (fs.existsSync(helpersDir)) {
          for (const h of fs.readdirSync(helpersDir)) {
            if (signOne(path.join(helpersDir, h))) signed++;
          }
        }

        // b) Sign .dylib files
        const libsDir = path.join(searchDir, 'Libraries');
        if (fs.existsSync(libsDir)) {
          for (const lib of fs.readdirSync(libsDir)) {
            if (lib.endsWith('.dylib') && signOne(path.join(libsDir, lib))) signed++;
          }
        }

        // c) Sign the framework's main binary (same name as framework)
        const fwBinary = path.join(searchDir, fwName);
        if (fs.existsSync(fwBinary)) {
          if (signOne(fwBinary)) signed++;
        }

        // d) Sign the .framework bundle itself
        if (signOne(fwPath)) signed++;
      }

      // e) Sign all Helper .app bundles
      for (const entry of fs.readdirSync(frameworksDir)) {
        if (entry.endsWith('.app')) {
          if (signOne(path.join(frameworksDir, entry))) signed++;
        }
      }
    }

    // Also sign any .node native modules in the asar unpacked dirs
    const unpackedDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const findNative = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) findNative(full);
          else if (entry.name.endsWith('.node') || entry.name.endsWith('.dylib')) {
            if (signOne(full)) signed++;
          }
        }
      };
      findNative(unpackedDir);
    }

    console.log(`  • afterPack: signed ${signed} nested components`);

    // f) Sign the main .app with entitlements + stable identifier
    execSync(
      `codesign --force --sign - --identifier com.trackflow.agent --entitlements "${entitlementsPath}" "${appPath}"`,
      { stdio: 'pipe' }
    );
    console.log('  • afterPack: ad-hoc signed successfully');

    // Verify
    const verify = execSync(`codesign -dv --entitlements - "${appPath}" 2>&1`, { encoding: 'utf8' });
    if (verify.includes('allow-jit')) console.log('  • afterPack: entitlements verified ✓');
    if (verify.includes('com.trackflow.agent')) console.log('  • afterPack: stable identifier verified ✓');

  } catch (e) {
    console.error('  • afterPack: ad-hoc signing failed:', e.message);
  }
};
