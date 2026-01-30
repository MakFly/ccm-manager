import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { existsSync, statSync, rmSync, readdirSync, symlinkSync, lstatSync, readlinkSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { expandPath, type Provider } from './config.js';
import { shouldResetMemory, setLastMemoryReset } from './state.js';

// Cache for directory sizes to avoid recursive rescans
const dirSizeCache = new Map<string, { size: number; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

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
  '.ccsignore',     // File exclusion patterns (prevents OOM on large projects)
];

const CLEAN_THRESHOLDS = {
  'shell-snapshots': 10 * 1024 * 1024, // 10MB
  'debug': 5 * 1024 * 1024,            // 5MB
  'history.jsonl': 2 * 1024 * 1024     // 2MB - pour GLM
};

// Maximum size for session .jsonl files before aggressive cleanup
const MAX_SESSION_SIZE = 10 * 1024 * 1024; // 10MB
const SESSION_TRUNCATION_RATIO = 0.2; // Keep only last 20% when truncating

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

  // Check cache
  const cached = dirSizeCache.get(path);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.size;
  }

  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.size;

    let size = 0;
    const entries = readdirSync(path);
    for (const file of entries) {
      size += getDirSize(join(path, file));
    }

    // Cache result
    dirSizeCache.set(path, { size, timestamp: Date.now() });
    return size;
  } catch {
    return 0;
  }
}

function autoClean(configDir: string): void {
  const dir = expandPath(configDir);

  for (const [subdir, threshold] of Object.entries(CLEAN_THRESHOLDS)) {
    const path = join(dir, subdir);

    // Special handling for history.jsonl (truncate instead of delete)
    if (subdir === 'history.jsonl') {
      if (existsSync(path)) {
        try {
          const stat = statSync(path);
          if (stat.size > threshold) {
            const beforeSize = stat.size;
            truncateSessionFile(path, 0.3); // Keep 30% of history
            const afterSize = statSync(path).size;
            console.error(`[ccs] Auto-truncated history.jsonl (${Math.round(beforeSize / 1024)}KB → ${Math.round(afterSize / 1024)}KB)`);
          }
        } catch {
          // Ignore errors
        }
      }
      continue;
    }

    // For directories, use size-based cleanup
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

/**
 * Truncate a .jsonl file keeping only the last N% of lines
 * This mimics Anthropic's summarization behavior for GLM
 */
function truncateSessionFile(filePath: string, ratio: number = SESSION_TRUNCATION_RATIO): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length <= 10) return false; // Keep small sessions as-is

    // Keep only the last N% of lines (minimum 10 lines)
    const keepCount = Math.max(10, Math.floor(lines.length * ratio));
    const truncatedLines = lines.slice(-keepCount);

    writeFileSync(filePath, truncatedLines.join('\n') + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean oversized session files in projects directory
 * This prevents .jsonl files from growing to 48MB+ like with GLM
 */
function cleanOversizedSessions(configDir: string): {cleaned: number, savedBytes: number} {
  const projectsDir = join(expandPath(configDir), 'projects');
  if (!existsSync(projectsDir)) return { cleaned: 0, savedBytes: 0 };

  let cleaned = 0;
  let savedBytes = 0;

  try {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const projectDir of projectDirs) {
      const projectPath = join(projectsDir, projectDir);
      const jsonlFiles = readdirSync(projectPath)
        .filter(f => f.endsWith('.jsonl') && f !== 'sessions-index.json');

      for (const jsonlFile of jsonlFiles) {
        const filePath = join(projectPath, jsonlFile);
        try {
          const stat = statSync(filePath);

          if (stat.size > MAX_SESSION_SIZE) {
            const beforeSize = stat.size;
            const truncated = truncateSessionFile(filePath);
            if (truncated) {
              const afterSize = statSync(filePath).size;
              savedBytes += (beforeSize - afterSize);
              cleaned++;
            }
          }
        } catch {
          // Skip files that can't be processed
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return { cleaned, savedBytes };
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
    const source = resource === '.ccsignore'
      ? expandPath('~/.ccsignore')
      : join(baseSource, resource);
    const target = join(targetDir, resource);
    ensureSymlink(source, target);
  }
}

/**
 * Clean OAuth account from api_key provider configs
 * OAuth credentials conflict with API token authentication
 */
function cleanOAuthFromApiKeyProvider(configDir: string): void {
  const targetDir = expandPath(configDir);
  const targetFile = join(targetDir, '.claude.json');

  if (!existsSync(targetFile)) return;

  try {
    const data = JSON.parse(readFileSync(targetFile, 'utf-8'));

    // If oauthAccount exists, remove it (it conflicts with ANTHROPIC_AUTH_TOKEN env var)
    if (data.oauthAccount) {
      delete data.oauthAccount;
      writeFileSync(targetFile, JSON.stringify(data, null, 2));
      console.error('[ccs] Removed OAuth credentials (using API token instead)');
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Sync MCP servers from ~/.claude/.claude.json to the provider's config
 * MCP servers are stored in ~/.claude/.claude.json (Claude Code's actual config)
 */
function syncMcpServers(configDir: string): void {
  const targetDir = expandPath(configDir);
  const sourceDir = expandPath('~/.claude');

  // Skip if target is the default config
  if (targetDir === sourceDir) return;

  // Read MCP servers from ~/.claude/.claude.json (source of truth)
  const sourceFile = join(sourceDir, '.claude.json');
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
    const source = resource === '.ccsignore'
      ? expandPath('~/.ccsignore')
      : join(baseSource, resource);
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
  const sourceDir = expandPath('~/.claude');

  // Skip if target is the default config
  if (targetDir === sourceDir) return null;

  // Read MCP servers from ~/.claude/.claude.json (source of truth)
  const sourceFile = join(sourceDir, '.claude.json');
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
  const configDir = expandPath(provider.configDir || '~/.claude');
  const isDefaultConfig = configDir === expandPath('~/.claude');

  // Memory reset for providers that need it (e.g., GLM to prevent OOM)
  // Only purge if last reset was > 24h ago
  if (provider.memoryReset && shouldResetMemory(providerKey)) {
    const cleaned = resetMemory(configDir);
    if (cleaned > 0) {
      console.error(`[ccs] Daily memory reset: cleared ${Math.round(cleaned / 1024 / 1024)}MB of cached data`);
    }
    setLastMemoryReset(providerKey);
  }

  // Auto-clean before launch
  autoClean(configDir);

  // Clean oversized session files (mimics Anthropic's summarization for GLM)
  if (provider.memoryReset) {
    const sessionResult = cleanOversizedSessions(configDir);
    if (sessionResult.cleaned > 0) {
      console.error(`[ccs] Cleaned ${sessionResult.cleaned} oversized session(s), freed ${Math.round(sessionResult.savedBytes / 1024 / 1024)}MB`);
    }
  }

  // Only sync resources if using a custom configDir (not ~/.claude)
  if (!isDefaultConfig) {
    // Share ~/.claude resources (commands, settings.json, agents, etc.) across providers
    ensureSharedResources(configDir);

    // Sync MCP servers from ~/.claude to this provider
    syncMcpServers(configDir);

    // For api_key providers, remove OAuth credentials to prevent conflicts
    if (provider.type === 'api_key') {
      cleanOAuthFromApiKeyProvider(configDir);
    }
  }

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
