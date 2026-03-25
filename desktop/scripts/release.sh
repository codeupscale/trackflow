#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# TrackFlow Desktop — Production Release Script
#
# Usage:
#   ./scripts/release.sh [patch|minor|major]
#
# What it does:
#   1. Runs tests (fails fast)
#   2. Bumps version
#   3. Builds macOS (x64 + arm64), Windows, Linux
#   4. Generates auto-update manifests (latest-mac.yml, latest.yml, latest-linux.yml)
#   5. Creates GitHub Release
#   6. Uploads artifacts ONE AT A TIME (reliable for large files)
#   7. Publishes release (makes it non-draft)
#
# Prerequisites:
#   - `gh` CLI authenticated: `gh auth login`
#   - On macOS (for DMG builds)
#   - `npm install` already done
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO="codeupscale/trackflow"
DIST_DIR="dist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ─── Preflight Checks ────────────────────────────────────────────

echo -e "${BLUE}Preflight checks...${NC}"

# Check gh CLI
if ! gh auth status &>/dev/null; then
  echo -e "${RED}Error: gh CLI not authenticated. Run: gh auth login${NC}"
  exit 1
fi

# Check we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Not in the desktop directory. Run from desktop/ or use scripts/release.sh${NC}"
  exit 1
fi

# Determine version bump type
BUMP=${1:-patch}
if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Invalid bump type: $BUMP. Use: patch, minor, or major${NC}"
  exit 1
fi

echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  TrackFlow Desktop Release ($BUMP)${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"

# ─── Step 1: Tests ────────────────────────────────────────────────

echo -e "\n${YELLOW}[1/7] Running tests...${NC}"
npm test -- --forceExit
echo -e "${GREEN}✓ Tests passed${NC}"

# ─── Step 2: Version Bump ─────────────────────────────────────────

echo -e "\n${YELLOW}[2/7] Bumping version ($BUMP)...${NC}"
NEW_VERSION=$(npm version $BUMP --no-git-tag-version)
VERSION_NUM=${NEW_VERSION#v}
TAG="v${VERSION_NUM}"
echo -e "${GREEN}✓ Version: $TAG${NC}"

# Check if this tag/release already exists and clean up
if gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  echo -e "${YELLOW}  Deleting existing release $TAG...${NC}"
  gh release delete "$TAG" --repo "$REPO" --yes 2>/dev/null || true
  git tag -d "$TAG" 2>/dev/null || true
  git push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

# ─── Step 3: Build All Platforms ──────────────────────────────────

echo -e "\n${YELLOW}[3/7] Building macOS (Intel + Apple Silicon)...${NC}"
npx electron-builder --mac --x64 --arm64
echo -e "${GREEN}✓ macOS builds complete${NC}"

echo -e "\n${YELLOW}[4/7] Building Windows (x64)...${NC}"
if npx electron-builder --win --x64 2>&1; then
  echo -e "${GREEN}✓ Windows build complete${NC}"
else
  echo -e "${YELLOW}⚠ Windows build failed (cross-compile may need Wine)${NC}"
fi

echo -e "\n${YELLOW}[5/7] Building Linux (x64)...${NC}"
if npx electron-builder --linux --x64 2>&1; then
  echo -e "${GREEN}✓ Linux build complete${NC}"
else
  echo -e "${YELLOW}⚠ Linux build failed${NC}"
fi

# ─── Step 4: Generate Auto-Update Manifests ───────────────────────

echo -e "\n${YELLOW}[6/7] Generating auto-update manifests...${NC}"

generate_manifest() {
  local FILE="$1"
  local OUTPUT="$2"

  if [ ! -f "$DIST_DIR/$FILE" ]; then
    echo -e "${YELLOW}  Skipping $OUTPUT — $FILE not found${NC}"
    return
  fi

  local SHA512=$(shasum -a 512 "$DIST_DIR/$FILE" | awk '{print $1}' | xxd -r -p | base64)
  local SIZE=$(stat -f%z "$DIST_DIR/$FILE" 2>/dev/null || stat -c%s "$DIST_DIR/$FILE" 2>/dev/null)

  cat > "$DIST_DIR/$OUTPUT" <<YAML
version: ${VERSION_NUM}
files:
  - url: ${FILE}
    sha512: ${SHA512}
    size: ${SIZE}
path: ${FILE}
sha512: ${SHA512}
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
YAML
  echo -e "  ${GREEN}✓${NC} $OUTPUT ($(echo "$SIZE" | awk '{printf "%.1f MB", $1/1048576}'))"
}

# macOS manifest — list both architectures, default to arm64
MAC_ARM="TrackFlow-${VERSION_NUM}-mac-arm64.zip"
MAC_X64="TrackFlow-${VERSION_NUM}-mac-x64.zip"

if [ -f "$DIST_DIR/$MAC_ARM" ] && [ -f "$DIST_DIR/$MAC_X64" ]; then
  SHA_ARM=$(shasum -a 512 "$DIST_DIR/$MAC_ARM" | awk '{print $1}' | xxd -r -p | base64)
  SIZE_ARM=$(stat -f%z "$DIST_DIR/$MAC_ARM" 2>/dev/null || stat -c%s "$DIST_DIR/$MAC_ARM" 2>/dev/null)
  SHA_X64=$(shasum -a 512 "$DIST_DIR/$MAC_X64" | awk '{print $1}' | xxd -r -p | base64)
  SIZE_X64=$(stat -f%z "$DIST_DIR/$MAC_X64" 2>/dev/null || stat -c%s "$DIST_DIR/$MAC_X64" 2>/dev/null)

  cat > "$DIST_DIR/latest-mac.yml" <<YAML
version: ${VERSION_NUM}
files:
  - url: ${MAC_ARM}
    sha512: ${SHA_ARM}
    size: ${SIZE_ARM}
  - url: ${MAC_X64}
    sha512: ${SHA_X64}
    size: ${SIZE_X64}
path: ${MAC_ARM}
sha512: ${SHA_ARM}
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
YAML
  echo -e "  ${GREEN}✓${NC} latest-mac.yml"
fi

generate_manifest "TrackFlow-${VERSION_NUM}-win-x64.exe" "latest.yml"
generate_manifest "TrackFlow-${VERSION_NUM}-x86_64.AppImage" "latest-linux.yml"

# ─── Step 5: Create Release + Upload ─────────────────────────────

echo -e "\n${YELLOW}[7/7] Publishing to GitHub...${NC}"

# Create a DRAFT release first (no artifacts — fast)
gh release create "$TAG" \
  --repo "$REPO" \
  --title "TrackFlow Desktop $TAG" \
  --draft \
  --notes "$(cat <<EOF
## TrackFlow Desktop $TAG

### Downloads
| Platform | File |
|---|---|
| macOS Apple Silicon (M1/M2/M3/M4) | TrackFlow-${VERSION_NUM}-mac-arm64.dmg |
| macOS Intel | TrackFlow-${VERSION_NUM}-mac-x64.dmg |
| Windows 10/11 (64-bit) | TrackFlow-${VERSION_NUM}-win-x64.exe |
| Linux (AppImage) | TrackFlow-${VERSION_NUM}-x86_64.AppImage |
| Linux (Debian/Ubuntu) | TrackFlow-${VERSION_NUM}-linux-amd64.deb |

### macOS Installation
1. Download the \`.dmg\` for your Mac
2. Drag TrackFlow to Applications
3. Run: \`xattr -cr /Applications/TrackFlow.app\`
4. Open TrackFlow

### Windows
1. Download the \`.exe\` installer
2. Run it (if SmartScreen warns, click **More info** → **Run anyway**)

### Linux
\`\`\`bash
# AppImage
chmod +x TrackFlow-${VERSION_NUM}-x86_64.AppImage
./TrackFlow-${VERSION_NUM}-x86_64.AppImage

# Debian/Ubuntu
sudo dpkg -i TrackFlow-${VERSION_NUM}-linux-amd64.deb
\`\`\`

### Auto-Updates
Existing users will be automatically updated on next app launch.
EOF
)"

echo -e "  ${GREEN}✓${NC} Draft release created"

# Upload artifacts ONE AT A TIME with retry (reliable for large files)
upload_with_retry() {
  local FILE="$1"
  local BASENAME=$(basename "$FILE")
  local MAX_RETRIES=3

  if [ ! -f "$FILE" ]; then
    return
  fi

  local SIZE=$(du -h "$FILE" | cut -f1)

  for attempt in $(seq 1 $MAX_RETRIES); do
    echo -ne "  Uploading ${BASENAME} (${SIZE})... attempt ${attempt}/${MAX_RETRIES}"
    if gh release upload "$TAG" "$FILE" --repo "$REPO" --clobber 2>/dev/null; then
      echo -e " ${GREEN}✓${NC}"
      return 0
    else
      echo -e " ${RED}✗${NC}"
      if [ $attempt -lt $MAX_RETRIES ]; then
        sleep $((attempt * 5))
      fi
    fi
  done

  echo -e "  ${RED}Failed to upload $BASENAME after $MAX_RETRIES attempts${NC}"
  return 1
}

# Upload small files first (manifests, blockmaps) — these are critical for auto-update
echo -e "\n  ${BLUE}Uploading auto-update manifests...${NC}"
for f in "$DIST_DIR"/latest-mac.yml "$DIST_DIR"/latest.yml "$DIST_DIR"/latest-linux.yml; do
  upload_with_retry "$f"
done

echo -e "\n  ${BLUE}Uploading blockmaps...${NC}"
for f in "$DIST_DIR"/*-${VERSION_NUM}*.blockmap; do
  upload_with_retry "$f"
done

echo -e "\n  ${BLUE}Uploading installers (this may take a few minutes)...${NC}"
# Upload in order: DMGs, ZIPs, EXE, AppImage, DEB
for f in \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-arm64.dmg" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-x64.dmg" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-arm64.zip" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-x64.zip" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-win-x64.exe" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-x86_64.AppImage" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-linux-amd64.deb" \
; do
  upload_with_retry "$f"
done

# Publish (remove draft flag)
echo -e "\n  Publishing release..."
gh release edit "$TAG" --repo "$REPO" --draft=false --latest
echo -e "  ${GREEN}✓${NC} Release published!"

# ─── Done ─────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release $TAG published!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Download: ${BLUE}https://github.com/$REPO/releases/tag/$TAG${NC}"
echo ""
echo "  Your team will auto-update on next app launch."
echo ""
