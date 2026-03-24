#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# TrackFlow Desktop — Release Script
#
# Usage:
#   ./scripts/release.sh [patch|minor|major]
#
# What it does:
#   1. Runs tests
#   2. Bumps version (default: patch)
#   3. Builds for macOS (x64 + arm64)
#   4. Creates a GitHub Release with all artifacts attached
#   5. Team members get auto-updated on next app launch
#
# Prerequisites:
#   - `gh` CLI authenticated (run `gh auth login` if not)
#   - On macOS for building .dmg
#   - npm install already done
# ─────────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check gh CLI is authenticated
if ! gh auth status &>/dev/null; then
  echo -e "${RED}Error: gh CLI not authenticated.${NC}"
  echo "Run: gh auth login"
  exit 1
fi

# Determine version bump type
BUMP=${1:-patch}
if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Invalid bump type: $BUMP${NC}"
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  TrackFlow Desktop Release ($BUMP)${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"

# Step 1: Run tests
echo -e "\n${YELLOW}[1/5] Running tests...${NC}"
npm test
echo -e "${GREEN}✓ Tests passed${NC}"

# Step 2: Bump version
echo -e "\n${YELLOW}[2/5] Bumping version ($BUMP)...${NC}"
NEW_VERSION=$(npm version $BUMP --no-git-tag-version)
echo -e "${GREEN}✓ Version bumped to $NEW_VERSION${NC}"

# Step 3: Build macOS (both architectures)
echo -e "\n${YELLOW}[3/5] Building macOS (Intel + Apple Silicon)...${NC}"
npx electron-builder --mac --x64 --arm64
echo -e "${GREEN}✓ macOS builds complete${NC}"

# Step 4: Build Windows (cross-compile from macOS)
echo -e "\n${YELLOW}[4/6] Building Windows (x64)...${NC}"
npx electron-builder --win --x64 || echo -e "${YELLOW}⚠ Windows build skipped (may need Wine for cross-compile)${NC}"

# Step 5: Build Linux
echo -e "\n${YELLOW}[5/6] Building Linux (x64)...${NC}"
npx electron-builder --linux --x64 || echo -e "${YELLOW}⚠ Linux build skipped (cross-compile not available)${NC}"

# Step 6: Create GitHub Release with all artifacts
echo -e "\n${YELLOW}[6/6] Creating GitHub Release...${NC}"

VERSION_NUM=${NEW_VERSION#v}
TAG="v${VERSION_NUM}"
DIST_DIR="dist"

# Collect all release artifacts
ARTIFACTS=()
for f in \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-arm64.dmg" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-x64.dmg" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-arm64.zip" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-x64.zip" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-arm64.dmg.blockmap" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-mac-x64.dmg.blockmap" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-win-x64.exe" \
  "$DIST_DIR/TrackFlow Setup ${VERSION_NUM}.exe" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-win-x64.exe.blockmap" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-x86_64.AppImage" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-x64.AppImage" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-linux-amd64.deb" \
  "$DIST_DIR/TrackFlow-${VERSION_NUM}-linux-x64.deb" \
  "$DIST_DIR/latest-mac.yml" \
  "$DIST_DIR/latest.yml" \
  "$DIST_DIR/latest-linux.yml" \
; do
  if [ -f "$f" ]; then
    ARTIFACTS+=("$f")
  fi
done

echo -e "${BLUE}Artifacts to upload:${NC}"
for a in "${ARTIFACTS[@]}"; do
  SIZE=$(du -h "$a" | cut -f1)
  echo "  ${SIZE}  $(basename "$a")"
done

# Create the release using gh CLI (uses existing auth, no separate token needed)
gh release create "$TAG" \
  --repo codeupscale/trackflow \
  --title "TrackFlow Desktop $TAG" \
  --notes "$(cat <<EOF
## TrackFlow Desktop $TAG

### Downloads
| Platform | File |
|---|---|
| macOS Apple Silicon (M1/M2/M3/M4) | TrackFlow-${VERSION_NUM}-mac-arm64.dmg |
| macOS Intel | TrackFlow-${VERSION_NUM}-mac-x64.dmg |
| Windows | TrackFlow-${VERSION_NUM}-win-x64.exe |
| Linux (AppImage) | TrackFlow-${VERSION_NUM}-x64.AppImage |
| Linux (deb) | TrackFlow-${VERSION_NUM}-linux-x64.deb |

### Installation
1. Download the file for your platform
2. macOS: Open the .dmg, drag TrackFlow to Applications
3. Windows: Run the .exe installer
4. Linux: Make the .AppImage executable and run it, or install the .deb package

### Auto-Updates
Existing users will be automatically updated on next app launch.
EOF
)" \
  "${ARTIFACTS[@]}"

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release $TAG published! 🚀${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "Download page:"
echo -e "  ${BLUE}https://github.com/codeupscale/trackflow/releases/tag/$TAG${NC}"
echo ""
echo "Your team will auto-update on next app launch."
