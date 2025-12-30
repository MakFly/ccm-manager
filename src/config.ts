import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ProviderEnv {
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface Provider {
  name: string;
  type: 'oauth' | 'api_key';
  description?: string;
  configDir: string;
  env?: ProviderEnv;
}

export interface Config {
  current: string;
  providers: Record<string, Provider>;
}

const CONFIG_PATH = join(homedir(), '.ccs', 'config.json');

export function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return {
      current: 'anthropic',
      providers: {
        anthropic: {
          name: 'Anthropic (OAuth)',
          type: 'oauth',
          configDir: '~/.claude'
        }
      }
    };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function writeConfig(config: Config): void {
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

export function listProviders(): Array<{ name: string; provider: Provider; current: boolean }> {
  const config = readConfig();
  return Object.entries(config.providers).map(([name, provider]) => ({
    name,
    provider,
    current: name === config.current
  }));
}

export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}
