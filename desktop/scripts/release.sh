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
#   3. Builds for macOS (x64 + arm64), Windows, Linux
#   4. Publishes to GitHub Releases
#   5. Team members get auto-updated on next app launch
#
# Prerequisites:
#   - GH_TOKEN environment variable set (GitHub Personal Access Token)
#   - On macOS for building .dmg (can cross-compile .exe and .AppImage)
#   - npm install already done
# ─────────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check GH_TOKEN
if [ -z "$GH_TOKEN" ]; then
  echo -e "${RED}Error: GH_TOKEN not set.${NC}"
  echo "Get one from: https://github.com/settings/tokens"
  echo "Then run: export GH_TOKEN=ghp_your_token_here"
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

# Step 3: Build + publish for macOS
echo -e "\n${YELLOW}[3/5] Building macOS (Intel + Apple Silicon)...${NC}"
npx electron-builder --mac --x64 --arm64 --publish always
echo -e "${GREEN}✓ macOS builds published${NC}"

# Step 4: Build + publish for Windows
echo -e "\n${YELLOW}[4/5] Building Windows (x64)...${NC}"
npx electron-builder --win --x64 --publish always
echo -e "${GREEN}✓ Windows build published${NC}"

# Step 5: Build + publish for Linux
echo -e "\n${YELLOW}[5/5] Building Linux (x64)...${NC}"
npx electron-builder --linux --x64 --publish always
echo -e "${GREEN}✓ Linux build published${NC}"

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release $NEW_VERSION published! 🚀${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "Your team will auto-update on next app launch."
echo "Or they can download manually from:"
echo "  https://github.com/codeupscale/trackflow-agent/releases/latest"
echo ""
echo "Artifacts:"
echo "  macOS Intel:   TrackFlow-${NEW_VERSION#v}-mac-x64.dmg"
echo "  macOS Silicon: TrackFlow-${NEW_VERSION#v}-mac-arm64.dmg"
echo "  Windows:       TrackFlow-Setup-${NEW_VERSION#v}.exe"
echo "  Linux:         TrackFlow-${NEW_VERSION#v}-x64.AppImage"
