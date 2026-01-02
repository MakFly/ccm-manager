import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { existsSync, statSync, rmSync, readdirSync, symlinkSync, lstatSync, readlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { expandPath, type Provider } from './config.js';
import { shouldResetMemory, setLastMemoryReset } from './state.js';

// Shared resources from ~/.claude to sync across all providers
const SHARED_RESOURCES = [
  'commands',       // Custom slash commands
  'settings.json',  // Status line, plugins, etc.
  'plugins',        // Installed plugins
  'skills',         // User skills (frontend-design, etc.)
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

  return results;
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

  // Share ~/.claude resources (commands, settings.json) across providers
  ensureSharedResources(provider.configDir);

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
