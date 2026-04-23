#!/bin/bash

# ZeroComp Beta - macOS Installation Helper
# This script removes quarantine attributes and installs the VST3

echo "==========================================="
echo "   ZeroComp Beta - Installation Helper"
echo "==========================================="
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script is for macOS only"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VST3_FILE="$SCRIPT_DIR/ZeroComp.vst3"

# Check if VST3 exists
if [ ! -d "$VST3_FILE" ]; then
    echo "❌ ZeroComp.vst3 not found in the same directory as this script"
    echo "   Please ensure the VST3 file is in: $SCRIPT_DIR"
    read -p "Press any key to exit..."
    exit 1
fi

echo "Found VST3 at: $VST3_FILE"
echo ""

# Remove quarantine attributes
echo "🔓 Removing macOS quarantine attributes..."
xattr -cr "$VST3_FILE"
xattr -d com.apple.quarantine "$VST3_FILE" 2>/dev/null

# Verify signature (if any)
echo "🔍 Checking code signature..."
codesign -dv "$VST3_FILE" 2>&1 | grep "Signature" || echo "   Note: Plugin is not signed (normal for beta)"
echo ""

# Create VST3 directory if it doesn't exist
VST3_DIR="$HOME/Library/Audio/Plug-Ins/VST3"
if [ ! -d "$VST3_DIR" ]; then
    echo "📁 Creating VST3 directory..."
    mkdir -p "$VST3_DIR"
fi

# Check if already installed
if [ -d "$VST3_DIR/ZeroComp.vst3" ]; then
    echo "⚠️  ZeroComp.vst3 already exists in VST3 folder"
    read -p "Do you want to replace it? (y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled"
        read -p "Press any key to exit..."
        exit 0
    fi
    rm -rf "$VST3_DIR/ZeroComp.vst3"
fi

# Copy VST3 to the plugins folder
echo "📦 Installing VST3 plugin..."
cp -R "$VST3_FILE" "$VST3_DIR/"

# Verify installation
if [ -d "$VST3_DIR/ZeroComp.vst3" ]; then
    echo "✅ Successfully installed to: $VST3_DIR/ZeroComp.vst3"
    echo ""
    echo "==========================================="
    echo "Installation complete!"
    echo ""
    echo "Next steps:"
    echo "1. Open your DAW"
    echo "2. Rescan VST3 plugins if needed"
    echo "3. Look for 'ZeroComp' in your effects list"
    echo ""
    echo "If the plugin doesn't appear:"
    echo "- Logic Pro: Preferences → Plug-In Manager → Reset & Rescan"
    echo "- REAPER: Options → Preferences → VST → Re-scan"
    echo "- Ableton: Preferences → Plug-ins → Rescan"
    echo "==========================================="
else
    echo "❌ Installation failed"
    echo "   Please try copying manually to: $VST3_DIR"
fi

echo ""
read -p "Press any key to close this window..."