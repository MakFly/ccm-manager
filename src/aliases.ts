import { readConfig, expandPath, type Provider } from './config.js';

function generateProviderAlias(name: string, provider: Provider): string {
  const configDir = provider.configDir.startsWith('~')
    ? provider.configDir
    : `"${provider.configDir}"`;

  if (provider.type === 'api_key' && provider.env) {
    const envVars = Object.entries(provider.env)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' \\\n    ');

    return `claude-${name}() {
  env ${envVars} \\
    CLAUDE_CONFIG_DIR=${configDir} \\
    claude "$@"
}`;
  }

  // OAuth provider
  return `claude-${name}() {
  env CLAUDE_CONFIG_DIR=${configDir} \\
    claude "$@"
}`;
}

export function generateAliases(): string {
  const config = readConfig();
  const lines: string[] = [
    '# CCS - Claude Code Switch',
    '# Generated aliases - do not edit manually',
    ''
  ];

  // Generate provider-specific aliases (claude-glm, claude-anthropic)
  for (const [name, provider] of Object.entries(config.providers)) {
    lines.push(generateProviderAlias(name, provider));
    lines.push('');
  }

  // Add ccm as alias for ccs
  lines.push('alias ccm="ccs"');
  lines.push('');

  // Add ccc as "ccs run"
  lines.push('ccc() { ccs run "$@"; }');
  lines.push('');

  return lines.join('\n');
}

export function getSetupInstructions(): string {
  return `# Add to ~/.zshrc or ~/.bashrc:

# CCS - Claude Code Switch
export PATH="$HOME/.ccs/bin:$PATH"
eval "$(ccs alias)"

# Then run:
source ~/.zshrc
`;
}
