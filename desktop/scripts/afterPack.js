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

  // 2. Fix bundle identifier: electron-builder sometimes leaves it as "Electron"
  //    when code signing is skipped. The correct ID must match appId in package.json.
  if (cleaned.includes('<string>Electron</string>') && cleaned.includes('CFBundleIdentifier')) {
    cleaned = cleaned.replace(
      /<key>CFBundleIdentifier<\/key>\s*<string>Electron<\/string>/,
      '<key>CFBundleIdentifier</key><string>com.trackflow.agent</string>'
    );
    console.log('  • afterPack: fixed CFBundleIdentifier from "Electron" to "com.trackflow.agent"');
  }

  if (cleaned !== original) {
    fs.writeFileSync(plistPath, cleaned, 'utf8');
    console.log('  • afterPack: cleaned Info.plist');
  }

  // 3. Ad-hoc sign with entitlements.
  //    Without a Developer ID cert, electron-builder skips signing entirely,
  //    which means entitlements from entitlements.mac.plist are NEVER applied.
  //    Ad-hoc signing (`codesign -s -`) applies entitlements without a real cert.
  //    This is required for:
  //      - desktopCapturer (screen capture) to work
  //      - Hardened runtime to be honored by macOS
  //      - The app to not be immediately killed by Gatekeeper on macOS 14+
  const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  if (fs.existsSync(entitlementsPath)) {
    try {
      console.log('  • afterPack: ad-hoc signing with entitlements...');
      execSync(
        `codesign --force --deep --sign - --entitlements "${entitlementsPath}" "${appPath}"`,
        { stdio: 'pipe' }
      );
      console.log('  • afterPack: ad-hoc signed successfully');

      // Verify
      const verify = execSync(`codesign -dv --entitlements - "${appPath}" 2>&1`, { encoding: 'utf8' });
      if (verify.includes('allow-jit')) {
        console.log('  • afterPack: entitlements verified ✓');
      }
    } catch (e) {
      console.error('  • afterPack: ad-hoc signing failed:', e.message);
      // Don't fail the build — unsigned app still works, just without entitlements
    }
  }
};
