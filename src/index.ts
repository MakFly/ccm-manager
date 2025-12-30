#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import {
  readConfig,
  getCurrentProvider,
  getProvider,
  setCurrentProvider,
  listProviders,
  addProvider,
  removeProvider,
  getConfigPath,
  type Provider,
  type ProviderEnv
} from './config.js';
import { runClaude, syncSharedResources, type SyncResult } from './runner.js';
import { generateAliases, getSetupInstructions } from './aliases.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

// Interactive prompt helper
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

program
  .name('ccs')
  .description('Claude Code Switch - Lightweight model switcher')
  .version(version);

// Status command
program
  .command('status')
  .description('Show current provider')
  .action(() => {
    const provider = getCurrentProvider();
    if (!provider) {
      console.log(chalk.red('No provider configured'));
      return;
    }
    const config = readConfig();
    console.log(chalk.bold('Current provider:'), chalk.cyan(config.current));
    console.log(chalk.gray(`  ${provider.name}`));
    if (provider.description) {
      console.log(chalk.gray(`  ${provider.description}`));
    }
    if (provider.env?.ANTHROPIC_MODEL) {
      console.log(chalk.gray(`  Model: ${provider.env.ANTHROPIC_MODEL}`));
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List all providers')
  .action(() => {
    const providers = listProviders();
    console.log(chalk.bold('\nProviders:\n'));
    for (const { key, provider, current } of providers) {
      const marker = current ? chalk.green('●') : chalk.gray('○');
      const label = current ? chalk.cyan.bold(key) : chalk.white(key);
      console.log(`  ${marker} ${label}`);
      console.log(chalk.gray(`    ${provider.name}`));
      if (provider.env?.ANTHROPIC_MODEL) {
        console.log(chalk.gray(`    Model: ${provider.env.ANTHROPIC_MODEL}`));
      }
    }
    console.log('');
  });

// Use command (explicit switch)
program
  .command('use <provider>')
  .description('Switch to a provider')
  .action((name: string) => {
    if (setCurrentProvider(name)) {
      const provider = getProvider(name);
      console.log(chalk.green(`✓ Switched to ${name}`));
      if (provider?.env?.ANTHROPIC_MODEL) {
        console.log(chalk.gray(`  Model: ${provider.env.ANTHROPIC_MODEL}`));
      }
    } else {
      console.log(chalk.red(`Provider '${name}' not found`));
      console.log(chalk.gray('Run "ccs list" to see available providers'));
      process.exit(1);
    }
  });

// Add command (interactive)
program
  .command('add <key>')
  .description('Add a new provider interactively')
  .action(async (key: string) => {
    console.log(chalk.bold(`\nAdding provider: ${chalk.cyan(key)}\n`));

    // Provider name
    const name = await prompt(chalk.white('Display name (e.g., "GLM-4.7"): '));
    if (!name) {
      console.log(chalk.red('Name is required'));
      process.exit(1);
    }

    // Provider type
    const typeInput = await prompt(chalk.white('Type [oauth/api_key] (default: api_key): '));
    const type = (typeInput === 'oauth' ? 'oauth' : 'api_key') as 'oauth' | 'api_key';

    // Config directory
    const configDirInput = await prompt(chalk.white(`Config directory (default: ~/.claude-${key}): `));
    const configDir = configDirInput || `~/.claude-${key}`;

    // Description (optional)
    const description = await prompt(chalk.white('Description (optional): '));

    // Environment variables for api_key type
    let env: ProviderEnv | undefined;
    if (type === 'api_key') {
      console.log(chalk.gray('\nEnvironment variables (press Enter to skip):'));

      const authToken = await prompt(chalk.white('  ANTHROPIC_AUTH_TOKEN: '));
      const apiKey = await prompt(chalk.white('  ANTHROPIC_API_KEY: '));
      const model = await prompt(chalk.white('  ANTHROPIC_MODEL: '));
      const baseUrl = await prompt(chalk.white('  ANTHROPIC_BASE_URL: '));

      env = {};
      if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
      if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
      if (model) env.ANTHROPIC_MODEL = model;
      if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;

      if (Object.keys(env).length === 0) {
        env = undefined;
      }
    }

    const provider: Provider = {
      name,
      type,
      configDir,
      ...(description && { description }),
      ...(env && { env })
    };

    const result = addProvider(key, provider);
    if (result.success) {
      console.log(chalk.green(`\n✓ Provider '${key}' added successfully`));
      console.log(chalk.gray(`  Config: ${getConfigPath()}`));
    } else {
      console.log(chalk.red(`\n✗ ${result.error}`));
      process.exit(1);
    }
  });

// Remove command
program
  .command('remove <key>')
  .alias('rm')
  .description('Remove a provider')
  .option('-f, --force', 'Skip confirmation')
  .action(async (key: string, options: { force?: boolean }) => {
    const provider = getProvider(key);
    if (!provider) {
      console.log(chalk.red(`Provider '${key}' not found`));
      process.exit(1);
    }

    if (!options.force) {
      const confirm = await prompt(chalk.yellow(`Remove provider '${key}' (${provider.name})? [y/N]: `));
      if (confirm.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        return;
      }
    }

    const result = removeProvider(key);
    if (result.success) {
      console.log(chalk.green(`✓ Provider '${key}' removed`));
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
      process.exit(1);
    }
  });

// Run command
program
  .command('run [provider]')
  .description('Run Claude with optional provider switch')
  .option('--no-dangerously-skip-permissions', 'Disable default skip-permissions behavior')
  .allowUnknownOption(true)
  .action((providerName: string | undefined, options: any, command: Command) => {
    // Get extra args passed to claude
    const extraArgs = command.args.slice(providerName ? 1 : 0);

    let provider;
    if (providerName) {
      provider = getProvider(providerName);
      if (!provider) {
        console.log(chalk.red(`Provider '${providerName}' not found`));
        process.exit(1);
      }
      setCurrentProvider(providerName);
    } else {
      provider = getCurrentProvider();
    }

    if (!provider) {
      console.log(chalk.red('No provider configured'));
      process.exit(1);
    }

    const config = readConfig();
    console.log(chalk.gray(`[ccs] Using ${config.current} (${provider.name})`));

    // By default, add --dangerously-skip-permissions (unless explicitly disabled)
    const claudeArgs = options.dangerouslySkipPermissions !== false
      ? ['--dangerously-skip-permissions', ...extraArgs]
      : extraArgs;

    const exitCode = runClaude(provider, claudeArgs);
    process.exit(exitCode);
  });

// Alias command
program
  .command('alias')
  .description('Generate shell aliases')
  .option('-i, --instructions', 'Show setup instructions')
  .action((options: { instructions?: boolean }) => {
    if (options.instructions) {
      console.log(getSetupInstructions());
    } else {
      console.log(generateAliases());
    }
  });

// Config command (show config path)
program
  .command('config')
  .description('Show config file path')
  .action(() => {
    console.log(chalk.bold('Config file:'), chalk.cyan(getConfigPath()));
  });

// Sync command
program
  .command('sync')
  .description('Sync shared resources (commands, settings, plugins) from ~/.claude')
  .option('-a, --all', 'Sync all providers')
  .option('-f, --force', 'Force replace existing files/directories')
  .action((options: { all?: boolean; force?: boolean }) => {
    const force = options.force ?? false;

    const displayResults = (providerKey: string, results: SyncResult[] | null) => {
      console.log(chalk.bold(`\n${providerKey}:`));
      if (results === null) {
        console.log(chalk.gray('  (source directory - skip)'));
        return;
      }
      for (const { resource, status } of results) {
        const icon = status === 'exists' ? chalk.gray('○') :
                     status === 'created' ? chalk.green('✓') :
                     status === 'forced' ? chalk.yellow('⚡') :
                     chalk.red('✗');
        const label = status === 'exists' ? chalk.gray('already synced') :
                      status === 'created' ? chalk.green('created') :
                      status === 'forced' ? chalk.yellow('forced') :
                      chalk.red('skipped');
        console.log(`  ${icon} ${resource} ${label}`);
      }
    };

    if (options.all) {
      const providers = listProviders();
      for (const { key, provider } of providers) {
        const results = syncSharedResources(provider.configDir, force);
        displayResults(key, results);
      }
    } else {
      const config = readConfig();
      const provider = getCurrentProvider();
      if (!provider) {
        console.log(chalk.red('No provider configured'));
        process.exit(1);
      }
      const results = syncSharedResources(provider.configDir, force);
      displayResults(config.current, results);
    }

    console.log('');
    console.log(chalk.gray('Synced from ~/.claude: commands, settings.json, plugins'));
  });

// Help command alias
program
  .command('help')
  .description('Show help')
  .action(() => {
    program.help();
  });

// Update command
program
  .command('update')
  .description('Update CCS to the latest version')
  .action(() => {
    console.log(chalk.bold('Checking for updates...'));

    // Detect package manager
    const hasBun = spawnSync('which', ['bun'], { encoding: 'utf-8' }).status === 0;
    const pm = hasBun ? 'bun' : 'npm';
    const args = ['update', '-g', 'cc-switch'];

    console.log(chalk.gray(`[ccs] Using ${pm} to update...`));

    const result = spawnSync(pm, args, {
      stdio: 'inherit',
      shell: false
    });

    if (result.status === 0) {
      // Get new version
      const newPkg = require('../package.json');
      console.log(chalk.green(`\n✓ CCS updated to v${newPkg.version}`));
    } else {
      console.log(chalk.red('\n✗ Update failed'));
      console.log(chalk.gray('Try manually: bun update -g cc-switch'));
      process.exit(1);
    }
  });

// Default action: if arg matches a provider, switch to it
// Otherwise show help
program
  .argument('[provider]', 'Provider to switch to')
  .option('--no-dangerously-skip-permissions', 'Disable default skip-permissions behavior')
  .action((providerName: string | undefined, options: any) => {
    if (!providerName) {
      // No args - run Claude with current provider
      const provider = getCurrentProvider();
      if (!provider) {
        program.help();
        return;
      }
      const config = readConfig();
      console.log(chalk.gray(`[ccs] Using ${config.current} (${provider.name})`));
      // By default, add --dangerously-skip-permissions (unless explicitly disabled)
      const claudeArgs = options.dangerouslySkipPermissions !== false
        ? ['--dangerously-skip-permissions']
        : [];
      const exitCode = runClaude(provider, claudeArgs);
      process.exit(exitCode);
    }

    // Check if it's a provider name
    const provider = getProvider(providerName);
    if (provider) {
      if (setCurrentProvider(providerName)) {
        console.log(chalk.green(`✓ Switched to ${providerName}`));
      }
    } else {
      console.log(chalk.red(`Unknown command or provider: ${providerName}`));
      console.log(chalk.gray('Run "ccs --help" for usage'));
      process.exit(1);
    }
  });

program.parse();
