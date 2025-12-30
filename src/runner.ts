import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { existsSync, statSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { expandPath, type Provider } from './config.js';

const CLEAN_THRESHOLDS = {
  'shell-snapshots': 10 * 1024 * 1024, // 10MB
  'debug': 5 * 1024 * 1024             // 5MB
};

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

export function runClaude(provider: Provider, args: string[]): number {
  const configDir = expandPath(provider.configDir);

  // Auto-clean before launch
  autoClean(provider.configDir);

  // Build environment
  const env: Record<string, string> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: configDir
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
