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
if $PM install -g cc-switch 2>/dev/null; then
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

# Create default .ccsignore to prevent OOM on large projects
CCSIGNORE="$HOME/.ccsignore"
if [ ! -f "$CCSIGNORE" ]; then
  cat > "$CCSIGNORE" << 'EOF'
# CCS Ignore - Exclude large directories from analysis
# This prevents JavaScript heap out of memory errors

# Symfony
vendor/
var/
bin/
public/bundles/

# Laravel
vendor/
storage/
bootstrap/cache/

# Node.js
node_modules/
dist/
build/
.next/
.nuxt/
.cache/

# Python
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
*.egg-info/

# Git
.git/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Temporary
tmp/
temp/
*.tmp
EOF
  echo "✓ Created ~/.ccsignore with default exclusion patterns"
else
  echo "  ~/.ccsignore already exists, skipping"
fi

# Build the binary
echo "Building CCS..."
if command -v bun &> /dev/null; then
    bun run build
fi

# Interactive provider configuration
echo ""
echo "=== Provider Configuration ==="
echo ""
read -p "Do you want to configure a provider now? (y/N): " CONFIGURE
if [[ "$CONFIGURE" =~ ^[yY]$ ]]; then
    read -p "Provider name (e.g. glm): " PROVIDER_NAME
    read -p "API key: " API_KEY
    read -p "Base URL (optional, press Enter to skip): " BASE_URL
    read -p "Model (optional, press Enter to skip): " MODEL

    if [ -n "$PROVIDER_NAME" ] && [ -n "$API_KEY" ]; then
        CONFIG_DIR="$HOME/.config/ccs"
        mkdir -p "$CONFIG_DIR"
        CONFIG_FILE="$CONFIG_DIR/config.json"

        # Build provider JSON
        PROVIDER_JSON="{\"apiKey\":\"$API_KEY\""
        [ -n "$BASE_URL" ] && PROVIDER_JSON="$PROVIDER_JSON,\"baseUrl\":\"$BASE_URL\""
        [ -n "$MODEL" ] && PROVIDER_JSON="$PROVIDER_JSON,\"model\":\"$MODEL\""
        PROVIDER_JSON="$PROVIDER_JSON}"

        if [ -f "$CONFIG_FILE" ]; then
            # Merge into existing config using a temp approach
            TMP=$(mktemp)
            if command -v jq &> /dev/null; then
                jq --arg name "$PROVIDER_NAME" --argjson prov "$PROVIDER_JSON" '.providers[$name] = $prov' "$CONFIG_FILE" > "$TMP" && mv "$TMP" "$CONFIG_FILE"
            else
                echo "{\"providers\":{\"$PROVIDER_NAME\":$PROVIDER_JSON}}" > "$CONFIG_FILE"
            fi
        else
            echo "{\"providers\":{\"$PROVIDER_NAME\":$PROVIDER_JSON}}" > "$CONFIG_FILE"
        fi
        echo "✓ Provider '$PROVIDER_NAME' configured!"
    else
        echo "Skipped: provider name and API key are required."
    fi
fi

# Add to PATH
SHELL_RC="$HOME/.zshrc"
PATH_LINE='export PATH="$HOME/.ccs/dist:$PATH"'
if ! grep -qF '.ccs/dist' "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# CCS - Claude Code Switch" >> "$SHELL_RC"
    echo "$PATH_LINE" >> "$SHELL_RC"
    echo "✓ Added CCS to PATH in ~/.zshrc"
else
    echo "  CCS already in PATH"
fi

echo ""
echo "✓ Installation complete!"
echo "  Run: source ~/.zshrc && ccs --help"
