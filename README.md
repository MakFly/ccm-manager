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
- **MCP Sync**: Automatically syncs MCP servers across all providers
- **Resource Sync**: Shares commands, settings, plugins, skills, agents, CLAUDE.md across providers

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
| `ccs sync [provider]` | Sync shared resources & MCP servers |
| `ccs sync --all` | Sync all providers |
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

## Resource Sync

CCS automatically syncs shared resources from `~/.claude` to all provider config directories:

| Resource | Type | Description |
|----------|------|-------------|
| `commands/` | symlink | Custom slash commands |
| `settings.json` | symlink | Status line, plugins config |
| `plugins/` | symlink | Installed plugins |
| `skills/` | symlink | User skills |
| `agents/` | symlink | Custom agents |
| `CLAUDE.md` | symlink | User instructions |
| `AGENTS.md` | symlink | Agent instructions |
| `prompts/` | symlink | Prompt templates |

### Manual Sync

```bash
# Sync all providers
ccs sync --all

# Sync with force (recreate symlinks)
ccs sync --all --force

# Sync specific provider
ccs sync glm
```

## MCP Server Sync

CCS automatically syncs MCP servers from `~/.claude.json` to all provider config directories.

When you run `ccs run glm`, your MCP servers (web-search, assistant-ui, etc.) are automatically available.

### Adding MCP Servers (Important!)

Always use `-s user` flag to add MCP servers globally:

```bash
# HTTP server
claude mcp add my-server -s user --transport http https://api.example.com/mcp

# stdio server (npx)
claude mcp add next-devtools -s user -- npx next-devtools-mcp@latest

# stdio server with args
claude mcp add assistant-ui -s user -- npx -y @assistant-ui/mcp-docs-server
```

### MCP Scopes

| Flag | Scope | Synced by CCS | Storage |
|------|-------|---------------|---------|
| `-s user` | Global | ✅ Yes | `~/.claude.json` |
| `-s local` | Project (private) | ❌ No | Project config |
| `-s project` | Project (shared) | ❌ No | `.mcp.json` |

> **Rule**: Always use **`-s user`** so CCS syncs MCP servers to all providers.

### How it works

1. MCP servers are stored in `~/.claude.json` (source of truth)
2. On each `ccs run <provider>`, MCP servers are merged into `~/<provider-config>/.claude.json`
3. New servers are added, existing servers are updated

### Verify MCP Sync

```bash
# Check MCP servers for a specific provider
CLAUDE_CONFIG_DIR=~/.claude-glm claude mcp list
```

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
