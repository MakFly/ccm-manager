#!/bin/bash
set -e

# CCS - Claude Code Switch Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/MakFly/ccm-manager/main/install.sh | bash

REPO="MakFly/ccm-manager"
INSTALL_DIR="$HOME/.ccs"

echo "Installing CCS (Claude Code Switch)..."

# Check for bun or npm
if command -v bun &> /dev/null; then
    PM="bun"
elif command -v npm &> /dev/null; then
    PM="npm"
else
    echo "Error: bun or npm is required"
    echo "Install bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Method 1: Try npm/bun global install first
echo "Attempting global install via $PM..."
if $PM install -g @makfly/ccs 2>/dev/null; then
    echo ""
    echo "✓ CCS installed successfully!"
    echo ""
    echo "Usage:"
    echo "  ccs --help     Show help"
    echo "  ccs add glm    Add a provider"
    echo "  ccs list       List providers"
    echo "  ccs update     Update CCS"
    exit 0
fi

# Method 2: Clone from git
echo "Global install failed, cloning from GitHub..."

if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --quiet
else
    git clone --quiet "https://github.com/$REPO.git" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
$PM install --quiet

echo ""
echo "✓ CCS installed to $INSTALL_DIR"
echo ""
echo "Add to your shell config (~/.zshrc or ~/.bashrc):"
echo ""
echo '  export PATH="$HOME/.ccs/bin:$PATH"'
echo '  eval "$(ccs alias)"'
echo ""
echo "Then run: source ~/.zshrc"
