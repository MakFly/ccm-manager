# CCS - Claude Code Switch

Lightweight CLI to switch between AI model providers for Claude Code.

## Features

- Switch between Anthropic (OAuth) and custom API providers (GLM, etc.)
- Simple commands: `ccs glm`, `ccs anthropic`
- Shell aliases: `claude-glm`, `claude-anthropic`, `ccm`, `ccc`
- Auto-clean: cleans large temp files on startup
- **No TTY issues**: runs Claude in foreground (fixes "suspended tty output" bug)

## Installation

```bash
# Clone
git clone https://github.com/MakFly/ccm-manager.git ~/.ccs

# Install deps
cd ~/.ccs && bun install

# Copy config
cp config.example.json config.json
# Edit config.json with your API tokens

# Add to ~/.zshrc or ~/.bashrc
echo 'export PATH="$HOME/.ccs/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(ccs alias)"' >> ~/.zshrc
source ~/.zshrc
```

## Usage

```bash
# Show current provider
ccs status

# List providers
ccs list

# Switch provider
ccs glm
ccs anthropic

# Run Claude with current provider
ccs

# Run Claude with specific provider
ccs run glm

# Shortcuts (after shell setup)
ccm glm          # = ccs glm
ccc              # = ccs run
ccc glm          # = ccs run glm
claude-glm       # Direct alias
claude-anthropic # Direct alias
```

## Configuration

Edit `config.json`:

```json
{
  "current": "anthropic",
  "providers": {
    "glm": {
      "name": "GLM-4.7",
      "type": "api_key",
      "configDir": "~/.claude-glm",
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_MODEL": "glm-4.7",
        "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic"
      }
    },
    "anthropic": {
      "name": "Anthropic (OAuth)",
      "type": "oauth",
      "configDir": "~/.claude"
    }
  }
}
```

## License

MIT
