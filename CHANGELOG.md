# Changelog

All notable changes to CCS (Claude Code Switch) will be documented in this file.

## [1.3.0] - 2026-01-03

### Added
- **MCP Server Sync**: Automatically syncs MCP servers from `~/.claude.json` to all provider configs
- **Extended Resource Sync**: Now syncs `agents/`, `CLAUDE.md`, `AGENTS.md`, `prompts/` in addition to existing resources
- New documentation sections for Resource Sync and MCP Server Sync

### Changed
- MCP servers are now read from `~/.claude.json` (source of truth) and merged into provider configs
- Improved sync command output with MCP server status

### Fixed
- MCP servers now properly available when using alternate providers (e.g., `ccs run glm`)

## [1.2.1] - 2024-12-31

### Fixed
- Minor bug fixes

## [1.2.0] - 2024-12-30

### Added
- `ccs sync` command to manually sync shared resources
- `ccs sync --all` to sync all providers at once
- `--force` flag to recreate symlinks

### Changed
- Improved shared resource management with symlinks

## [1.1.0] - 2024-12-29

### Added
- Memory reset feature for providers (`memoryReset: true`)
- Daily auto-cleanup of memory-intensive directories

## [1.0.0] - 2024-12-28

### Added
- Initial release
- Multi-provider support (OAuth and API key)
- Interactive provider management (`ccs add`, `ccs remove`)
- Shell aliases generation
- Auto-cleanup of cache directories
- Zod schema validation for config
- Self-update command (`ccs update`)
