# CCS - Claude Code Switch

Lightweight CLI to switch between AI model providers for Claude Code.

## Features

- Switch between Anthropic (OAuth) and custom API providers (GLM, etc.)
- **Interactive provider management**: `ccs add`, `ccs remove`
- **Self-update**: `ccs update`
- Simple commands: `ccs glm`, `ccs anthropic`
- Shell aliases: `claude-glm`, `claude-anthropic`, `ccm`, `ccc`
- Auto-clean: removes large cache files on startup
- **Config validation**: Zod schema validation with helpful error messages
- **No TTY issues**: runs Claude in foreground (fixes "suspended tty output" bug)

## Installation

### Option 1: npm/bun (Recommended)

```bash
# With bun (faster)
bun install -g cc-switch

# Or with npm
npm install -g cc-switch
```

### Option 2: One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/MakFly/ccm-manager/main/install.sh | bash
```

### Option 3: Manual install

```bash
# Clone
git clone https://github.com/MakFly/ccm-manager.git ~/.ccs

# Install dependencies
cd ~/.ccs && bun install

# Add to ~/.zshrc or ~/.bashrc
echo 'export PATH="$HOME/.ccs/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(ccs alias)"' >> ~/.zshrc
source ~/.zshrc
```

## Updating

```bash
# Self-update (auto-detects bun/npm)
ccs update

# Or manually
bun update -g cc-switch
npm update -g cc-switch
```

## Quick Start

```bash
# Add a new provider interactively
ccs add glm

# List all providers
ccs list

# Switch to a provider
ccs glm

# Run Claude with current provider
ccs

# Run Claude with a specific provider
ccs run glm
```

## Commands

| Command | Description |
|---------|-------------|
| `ccs` | Run Claude with current provider |
| `ccs status` | Show current provider |
| `ccs list` / `ccs ls` | List all providers |
| `ccs use <provider>` | Switch to a provider |
| `ccs run [provider]` | Run Claude (optional provider switch) |
| `ccs add <key>` | Add a new provider interactively |
| `ccs remove <key>` / `ccs rm` | Remove a provider |
| `ccs update` | Update CCS to latest version |
| `ccs alias` | Generate shell aliases |
| `ccs alias -i` | Show shell setup instructions |
| `ccs config` | Show config file path |

## Shell Aliases

After running `eval "$(ccs alias)"`:

```bash
ccm glm          # = ccs glm (switch provider)
ccc              # = ccs run (run Claude)
ccc glm          # = ccs run glm
claude-glm       # Direct provider alias
claude-anthropic # Direct provider alias
```

## Configuration

Config is stored at `~/.ccs/config.json` (or `$CCS_CONFIG_PATH` if set).

### Example Configuration

```json
{
  "current": "anthropic",
  "providers": {
    "anthropic": {
      "name": "Anthropic (OAuth)",
      "type": "oauth",
      "configDir": "~/.claude"
    },
    "glm": {
      "name": "GLM-4.7",
      "type": "api_key",
      "description": "GLM-4.7 via Z.AI",
      "configDir": "~/.claude-glm",
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_MODEL": "glm-4.7",
        "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic"
      }
    }
  }
}
```

### Provider Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `oauth` | Anthropic OAuth login | `configDir` |
| `api_key` | Custom API provider | `configDir`, `env` with API credentials |

### Environment Variables for Providers

For `api_key` providers, you can set:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_AUTH_TOKEN` | Authentication token |
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_MODEL` | Model name |
| `ANTHROPIC_BASE_URL` | API endpoint URL |

## Adding Providers

### Interactive (Recommended)

```bash
ccs add my-provider
# Follow the prompts
```

### Manual

Edit `~/.ccs/config.json` directly.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CCS_CONFIG_PATH` | Custom config file path |

## Auto-Cleanup

CCS automatically cleans up large cache directories before launching Claude:

- `shell-snapshots/` if > 10MB
- `debug/` if > 5MB

This prevents Claude from slowing down due to accumulated cache files.

## Troubleshooting

### "TTY suspended" issues

CCS runs Claude with `stdio: 'inherit'`, which fixes terminal issues. If you still have problems, ensure you're running `ccs` directly (not through a pipe).

### Config validation errors

If your config is invalid, CCS will show detailed errors:

```
[ccs] Invalid config.json:
  - providers.glm.env.ANTHROPIC_BASE_URL: Invalid url
[ccs] Using default config. Fix your config.json or delete it to regenerate.
```

### Reset to defaults

Delete the config file to reset:

```bash
rm ~/.ccs/config.json
```

## Uninstall

```bash
# If installed via npm/bun
bun remove -g cc-switch
# or
npm uninstall -g cc-switch

# If installed manually
rm -rf ~/.ccs
# Remove lines from ~/.zshrc or ~/.bashrc
```

## Requirements

- [Bun](https://bun.sh/) or Node.js >= 18
- [Claude Code](https://claude.ai) CLI installed

## License

MIT - See [LICENSE](LICENSE) for details.
