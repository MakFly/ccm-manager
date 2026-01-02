import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// Zod schemas for validation
const ProviderEnvSchema = z.object({
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
}).strict();

const ProviderSchema = z.object({
  name: z.string().min(1, 'Provider name is required'),
  type: z.enum(['oauth', 'api_key']),
  description: z.string().optional(),
  configDir: z.string().min(1, 'configDir is required'),
  env: ProviderEnvSchema.optional(),
  memoryReset: z.boolean().optional(),  // Aggressive cleanup before each run (for memory-hungry providers)
});

const ConfigSchema = z.object({
  current: z.string().min(1, 'Current provider is required'),
  providers: z.record(z.string(), ProviderSchema).refine(
    (providers) => Object.keys(providers).length > 0,
    'At least one provider is required'
  ),
}).refine(
  (config) => config.providers[config.current] !== undefined,
  'Current provider must exist in providers list'
);

// Export types from Zod schemas
export type ProviderEnv = z.infer<typeof ProviderEnvSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_PATH = process.env.CCS_CONFIG_PATH || join(homedir(), '.ccs', 'config.json');

const DEFAULT_CONFIG: Config = {
  current: 'anthropic',
  providers: {
    anthropic: {
      name: 'Anthropic (OAuth)',
      type: 'oauth',
      configDir: '~/.claude'
    }
  }
};

export function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    const result = ConfigSchema.safeParse(raw);

    if (!result.success) {
      const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
      console.error(`[ccs] Invalid config.json:\n${errors}`);
      console.error('[ccs] Using default config. Fix your config.json or delete it to regenerate.');
      return DEFAULT_CONFIG;
    }

    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('[ccs] config.json contains invalid JSON. Using default config.');
    } else {
      console.error('[ccs] Error reading config.json:', error);
    }
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(config: Config): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getCurrentProvider(): Provider | null {
  const config = readConfig();
  return config.providers[config.current] || null;
}

export function getProvider(name: string): Provider | null {
  const config = readConfig();
  return config.providers[name] || null;
}

export function setCurrentProvider(name: string): boolean {
  const config = readConfig();
  if (!config.providers[name]) {
    return false;
  }
  config.current = name;
  writeConfig(config);
  return true;
}

export function addProvider(key: string, provider: Provider): { success: boolean; error?: string } {
  const config = readConfig();

  if (config.providers[key]) {
    return { success: false, error: `Provider '${key}' already exists. Use 'ccs remove ${key}' first.` };
  }

  // Validate the new provider
  const result = ProviderSchema.safeParse(provider);
  if (!result.success) {
    const errors = result.error.errors.map(e => e.message).join(', ');
    return { success: false, error: `Invalid provider: ${errors}` };
  }

  config.providers[key] = result.data;
  writeConfig(config);
  return { success: true };
}

export function removeProvider(key: string): { success: boolean; error?: string } {
  const config = readConfig();

  if (!config.providers[key]) {
    return { success: false, error: `Provider '${key}' not found.` };
  }

  if (Object.keys(config.providers).length === 1) {
    return { success: false, error: 'Cannot remove the last provider.' };
  }

  if (config.current === key) {
    // Switch to another provider before removing
    const otherProvider = Object.keys(config.providers).find(k => k !== key);
    if (otherProvider) {
      config.current = otherProvider;
    }
  }

  delete config.providers[key];
  writeConfig(config);
  return { success: true };
}

export function listProviders(): Array<{ key: string; provider: Provider; current: boolean }> {
  const config = readConfig();
  return Object.entries(config.providers).map(([key, provider]) => ({
    key,
    provider,
    current: key === config.current
  }));
}

export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
