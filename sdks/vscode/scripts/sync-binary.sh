#!/bin/bash
# sync-binary.sh
# Builds dipoleCODE (opencode-fork) and copies binaries to dipoleSTUDIO extension
#
# Usage:
#   ./sync-binary.sh                # Build all platforms
#   ./sync-binary.sh --single       # Build only current platform

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_PATH="${OPENCODE_PATH:-$(realpath "$SCRIPT_DIR/../../../../opencode-fork")}"
EXTENSION_PATH="${EXTENSION_PATH:-$(realpath "$SCRIPT_DIR/..")}"
SINGLE_PLATFORM=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --single)
            SINGLE_PLATFORM=true
            shift
            ;;
        --opencode-path)
            OPENCODE_PATH="$2"
            shift 2
            ;;
        --extension-path)
            EXTENSION_PATH="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=== dipoleCODE Binary Sync ==="
echo "OpenCode fork path: $OPENCODE_PATH"
echo "Extension path: $EXTENSION_PATH"

# Verify opencode-fork exists
if [ ! -f "$OPENCODE_PATH/packages/opencode/package.json" ]; then
    echo "ERROR: opencode-fork not found at $OPENCODE_PATH"
    exit 1
fi

# Navigate to opencode-fork
cd "$OPENCODE_PATH/packages/opencode"

# Build
echo ""
echo "[1/3] Building dipoleCODE..."

if [ "$SINGLE_PLATFORM" = true ]; then
    echo "  Building for current platform only..."
    bun run build --single
else
    echo "  Building for all platforms..."
    bun run build
fi

echo "  Build completed!"

# Create bin directory if not exists
BIN_DIR="$EXTENSION_PATH/bin"
mkdir -p "$BIN_DIR"

# Copy binaries
echo ""
echo "[2/3] Copying binaries to extension..."

DIST_DIR="$OPENCODE_PATH/packages/opencode/dist"
COPIED_COUNT=0

# Platform mapping
declare -A PLATFORMS=(
    ["opencode-windows-x64"]="opencode-win32-x64.exe"
    ["opencode-darwin-arm64"]="opencode-darwin-arm64"
    ["opencode-darwin-x64"]="opencode-darwin-x64"
    ["opencode-linux-x64"]="opencode-linux-x64"
    ["opencode-linux-arm64"]="opencode-linux-arm64"
)

for src_folder in "${!PLATFORMS[@]}"; do
    dest_name="${PLATFORMS[$src_folder]}"
    src_path="$DIST_DIR/$src_folder/bin/opencode"

    if [ -f "$src_path" ]; then
        cp "$src_path" "$BIN_DIR/$dest_name"
        size=$(du -h "$BIN_DIR/$dest_name" | cut -f1)
        echo "  Copied: $dest_name ($size)"
        ((COPIED_COUNT++))
    else
        echo "  Skipped: $src_folder (not built)"
    fi
done

echo ""
echo "[3/3] Summary"
echo "  Binaries copied: $COPIED_COUNT"
echo "  Location: $BIN_DIR"

echo ""
echo "  Contents of bin/:"
ls -lh "$BIN_DIR" | tail -n +2 | awk '{print "    " $9 " (" $5 ")"}'

echo ""
echo "=== Sync complete! ==="
