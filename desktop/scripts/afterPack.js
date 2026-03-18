const fs = require('fs');
const path = require('path');

function stripPlistKeys(xml, keys) {
  let out = xml;
  for (const key of keys) {
    const re = new RegExp(`<key>${key}<\\/key>\\s*<string>[\\s\\S]*?<\\/string>`, 'g');
    out = out.replace(re, '');
  }
  // Clean up any accidental whitespace bloat
  out = out.replace(/\\s{2,}/g, ' ');
  return out;
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;

  const plistPath = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Info.plist');
  if (!fs.existsSync(plistPath)) return;

  const original = fs.readFileSync(plistPath, 'utf8');
  const cleaned = stripPlistKeys(original, [
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
  ]);

  if (cleaned !== original) {
    fs.writeFileSync(plistPath, cleaned, 'utf8');
  }
};

