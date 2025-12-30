#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import {
  readConfig,
  getCurrentProvider,
  getProvider,
  setCurrentProvider,
  listProviders
} from './config.js';
import { runClaude } from './runner.js';
import { generateAliases, getSetupInstructions } from './aliases.js';

const program = new Command();

program
  .name('ccs')
  .description('Claude Code Switch - Lightweight model switcher')
  .version('1.0.0');

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
    for (const { name, provider, current } of providers) {
      const marker = current ? chalk.green('●') : chalk.gray('○');
      const label = current ? chalk.cyan.bold(name) : chalk.white(name);
      console.log(`  ${marker} ${label}`);
      console.log(chalk.gray(`    ${provider.name}`));
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
