import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { existsSync, statSync, rmSync, readdirSync, symlinkSync, lstatSync, readlinkSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { expandPath, type Provider } from './config.js';
import { shouldResetMemory, setLastMemoryReset } from './state.js';

// Shared resources from ~/.claude to sync across all providers
const SHARED_RESOURCES = [
  'commands',       // Custom slash commands
  'settings.json',  // Status line, plugins, etc.
  'plugins',        // Installed plugins
  'skills',         // User skills (frontend-design, etc.)
  'agents',         // Custom agents
  'CLAUDE.md',      // User instructions
  'AGENTS.md',      // Agent instructions (symlink to CLAUDE.md usually)
  'prompts',        // Prompt templates
];

const CLEAN_THRESHOLDS = {
  'shell-snapshots': 10 * 1024 * 1024, // 10MB
  'debug': 5 * 1024 * 1024             // 5MB
};

// Directories to wipe when memoryReset is enabled (prevents OOM on memory-hungry providers like GLM)
const MEMORY_RESET_TARGETS = [
  'projects',        // Conversation history per project - main memory hog
  'file-history',    // Read file cache
  'session-env',     // Session environment data
  'plans',           // Plan files
  'todos',           // Todo cache
];

function getDirSize(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.size;

    // Simple recursive size calculation
    let size = 0;
    for (const file of readdirSync(path)) {
      size += getDirSize(join(path, file));
    }
    return size;
  } catch {
    return 0;
  }
}

function autoClean(configDir: string): void {
  const dir = expandPath(configDir);

  for (const [subdir, threshold] of Object.entries(CLEAN_THRESHOLDS)) {
    const path = join(dir, subdir);
    const size = getDirSize(path);

    if (size > threshold) {
      try {
        rmSync(path, { recursive: true, force: true });
        console.error(`[ccs] Auto-cleaned ${subdir} (${Math.round(size / 1024 / 1024)}MB)`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function resetMemory(configDir: string): number {
  const dir = expandPath(configDir);
  let totalCleaned = 0;

  for (const subdir of MEMORY_RESET_TARGETS) {
    const path = join(dir, subdir);
    const size = getDirSize(path);

    if (size > 0) {
      try {
        rmSync(path, { recursive: true, force: true });
        totalCleaned += size;
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return totalCleaned;
}

function ensureSymlink(source: string, target: string, force = false): boolean {
  // Skip if source doesn't exist
  if (!existsSync(source)) return false;

  // Check current state
  try {
    if (lstatSync(target).isSymbolicLink()) {
      if (readlinkSync(target) === source) return false; // Already correct
      // Wrong symlink, remove it
      rmSync(target);
    } else if (existsSync(target)) {
      if (!force) return false; // Real file/directory exists, skip
      // Force mode: remove existing
      rmSync(target, { recursive: true });
    }
  } catch {
    // Target doesn't exist, continue to create
  }

  // Ensure parent directory exists
  const parentDir = dirname(target);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Create symlink
  try {
    symlinkSync(source, target);
    return true;
  } catch {
    return false;
  }
}

function ensureSharedResources(configDir: string): void {
  const baseSource = expandPath('~/.claude');
  const targetDir = expandPath(configDir);

  for (const resource of SHARED_RESOURCES) {
    const source = join(baseSource, resource);
    const target = join(targetDir, resource);
    ensureSymlink(source, target);
  }
}

/**
 * Sync MCP servers from ~/.claude.json to the provider's config
 * MCP servers are stored in ~/.claude.json (not ~/.claude/.claude.json)
 */
function syncMcpServers(configDir: string): void {
  const targetDir = expandPath(configDir);
  const homeDir = expandPath('~');

  // Skip if target is the default config (~/home dir)
  if (targetDir === homeDir || targetDir === expandPath('~/.claude')) return;

  // Read MCP servers from ~/.claude.json (source of truth)
  const sourceFile = join(homeDir, '.claude.json');
  if (!existsSync(sourceFile)) return;

  try {
    const sourceData = JSON.parse(readFileSync(sourceFile, 'utf-8'));
    const sourceMcpServers = sourceData.mcpServers || {};

    if (Object.keys(sourceMcpServers).length === 0) return;

    // Read or create target .claude.json inside the config directory
    const targetFile = join(targetDir, '.claude.json');
    let targetData: Record<string, unknown> = {};
    if (existsSync(targetFile)) {
      try {
        targetData = JSON.parse(readFileSync(targetFile, 'utf-8'));
      } catch {
        targetData = {};
      }
    }

    // Merge MCP servers (source overwrites target)
    const targetMcpServers = (targetData.mcpServers as Record<string, unknown>) || {};
    const mergedMcpServers = { ...targetMcpServers, ...sourceMcpServers };

    const currentJson = JSON.stringify(targetMcpServers);
    const mergedJson = JSON.stringify(mergedMcpServers);

    if (currentJson !== mergedJson) {
      targetData.mcpServers = mergedMcpServers;
      writeFileSync(targetFile, JSON.stringify(targetData, null, 2));
      console.error(`[ccs] Synced ${Object.keys(sourceMcpServers).length} MCP server(s) to ${configDir}`);
    }
  } catch (error) {
    console.error(`[ccs] Warning: Could not sync MCP servers: ${error}`);
  }
}

export type SyncResult = { resource: string; status: 'created' | 'exists' | 'skipped' | 'forced' };

export function syncSharedResources(configDir: string, force = false): SyncResult[] | null {
  const baseSource = expandPath('~/.claude');
  const targetDir = expandPath(configDir);

  // Skip if configDir is the source itself
  if (targetDir === baseSource) return null;

  const results: SyncResult[] = [];

  for (const resource of SHARED_RESOURCES) {
    const source = join(baseSource, resource);
    const target = join(targetDir, resource);

    if (!existsSync(source)) {
      results.push({ resource, status: 'skipped' });
      continue;
    }

    try {
      if (lstatSync(target).isSymbolicLink() && readlinkSync(target) === source) {
        results.push({ resource, status: 'exists' });
        continue;
      }
    } catch {
      // Target doesn't exist
    }

    const created = ensureSymlink(source, target, force);
    results.push({ resource, status: created ? (force ? 'forced' : 'created') : 'skipped' });
  }

  // Also sync MCP servers
  const mcpSynced = syncMcpServersForSync(configDir, force);
  if (mcpSynced !== null) {
    results.push({ resource: 'mcpServers', status: mcpSynced ? 'created' : 'exists' });
  }

  return results;
}

/**
 * Sync MCP servers for the sync command (returns status for reporting)
 */
function syncMcpServersForSync(configDir: string, force = false): boolean | null {
  const targetDir = expandPath(configDir);
  const homeDir = expandPath('~');

  // Skip if target is the default config
  if (targetDir === homeDir || targetDir === expandPath('~/.claude')) return null;

  // Read MCP servers from ~/.claude.json (source of truth)
  const sourceFile = join(homeDir, '.claude.json');
  if (!existsSync(sourceFile)) return null;

  try {
    const sourceData = JSON.parse(readFileSync(sourceFile, 'utf-8'));
    const sourceMcpServers = sourceData.mcpServers || {};

    if (Object.keys(sourceMcpServers).length === 0) return null;

    // Read or create target .claude.json
    const targetFile = join(targetDir, '.claude.json');
    let targetData: Record<string, unknown> = {};
    if (existsSync(targetFile)) {
      try {
        targetData = JSON.parse(readFileSync(targetFile, 'utf-8'));
      } catch {
        targetData = {};
      }
    }

    const targetMcpServers = (targetData.mcpServers as Record<string, unknown>) || {};

    // If force, overwrite; otherwise merge
    const mergedMcpServers = force
      ? { ...sourceMcpServers }
      : { ...targetMcpServers, ...sourceMcpServers };

    const currentJson = JSON.stringify(targetMcpServers);
    const mergedJson = JSON.stringify(mergedMcpServers);

    if (currentJson !== mergedJson) {
      targetData.mcpServers = mergedMcpServers;
      writeFileSync(targetFile, JSON.stringify(targetData, null, 2));
      return true;
    }

    return false;
  } catch {
    return null;
  }
}

export function runClaude(providerKey: string, provider: Provider, args: string[]): number {
  const configDir = expandPath(provider.configDir);

  // Memory reset for providers that need it (e.g., GLM to prevent OOM)
  // Only purge if last reset was > 24h ago
  if (provider.memoryReset && shouldResetMemory(providerKey)) {
    const cleaned = resetMemory(provider.configDir);
    if (cleaned > 0) {
      console.error(`[ccs] Daily memory reset: cleared ${Math.round(cleaned / 1024 / 1024)}MB of cached data`);
    }
    setLastMemoryReset(providerKey);
  }

  // Auto-clean before launch
  autoClean(provider.configDir);

  // Share ~/.claude resources (commands, settings.json, agents, etc.) across providers
  ensureSharedResources(provider.configDir);

  // Sync MCP servers from ~/.claude to this provider
  syncMcpServers(provider.configDir);

  // Build environment with increased memory limit for long conversations
  const currentNodeOptions = process.env['NODE_OPTIONS'] || '';
  const hasMaxOldSpace = currentNodeOptions.includes('--max-old-space-size');
  const nodeOptions = hasMaxOldSpace
    ? currentNodeOptions
    : `${currentNodeOptions} --max-old-space-size=8192`.trim();

  const env: Record<string, string> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: configDir,
    NODE_OPTIONS: nodeOptions  // 8GB heap limit to prevent OOM on long conversations
  };

  // Add provider-specific env vars
  if (provider.type === 'api_key' && provider.env) {
    for (const [key, value] of Object.entries(provider.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  // Run Claude in FOREGROUND with inherited stdio (FIX TTY!)
  const options: SpawnSyncOptions = {
    env,
    stdio: 'inherit',  // This is the key - inherit TTY from parent
    shell: false
  };

  const result = spawnSync('claude', args, options);

  return result.status ?? 1;
}
