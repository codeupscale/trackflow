const fs = require('fs');
const path = require('path');

function stripPlistKeys(xml, keys) {
  let out = xml;
  for (const key of keys) {
    // Match <key>KEY</key> followed by <string>...</string> (with optional whitespace between)
    const re = new RegExp(`<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`, 'g');
    out = out.replace(re, '');
  }
  // Clean up excessive whitespace left behind (regex was previously broken: used \\s instead of \s)
  out = out.replace(/\n\s*\n\s*\n/g, '\n\n');
  return out;
}

exports.default = async function afterPack(context) {
  // Only applies to macOS builds — skip on Windows/Linux
  if (context.electronPlatformName !== 'darwin') return;

  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;

  const plistPath = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Info.plist');
  if (!fs.existsSync(plistPath)) return;

  const original = fs.readFileSync(plistPath, 'utf8');

  // Strip unused permission descriptions that Electron injects by default.
  // We do NOT use microphone, camera, or Bluetooth — keeping them triggers
  // unnecessary macOS permission prompts and looks suspicious to users.
  const cleaned = stripPlistKeys(original, [
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
  ]);

  if (cleaned !== original) {
    fs.writeFileSync(plistPath, cleaned, 'utf8');
    console.log('  • afterPack: stripped unused permission descriptions from Info.plist');
  }
};
