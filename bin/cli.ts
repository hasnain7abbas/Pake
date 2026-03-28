import log from 'loglevel';
import chalk from 'chalk';
import updateNotifier from 'update-notifier';
import packageJson from '../package.json';
import BuilderProvider from './builders/BuilderProvider';
import handleInputOptions from './options/index';
import { getCliProgram } from './helpers/cli-program';
import { PakeCliOptions } from './types';
import {
  saveProfile,
  loadProfile,
  loadBatchConfig,
  listProfiles,
  deleteProfile,
  mergeProfileOptions,
} from './helpers/profiles';

const program = getCliProgram();

async function checkUpdateTips() {
  updateNotifier({ pkg: packageJson, updateCheckInterval: 1000 * 60 }).notify({
    isGlobal: true,
  });
}

async function buildSingleApp(url: string, options: PakeCliOptions) {
  const appOptions = await handleInputOptions(options, url);
  const builder = BuilderProvider.create(appOptions);
  await builder.prepare();
  await builder.build(url);
}

program.action(async (url: string, options: PakeCliOptions & {
  batch?: string;
  saveProfile?: string;
  loadProfile?: string;
}) => {
  await checkUpdateTips();

  log.setDefaultLevel('info');
  log.setLevel('info');
  if (options.debug) {
    log.setLevel('debug');
  }

  // Handle --batch mode: build multiple apps from a JSON config
  if (options.batch) {
    const batchConfig = await loadBatchConfig(options.batch);
    const total = batchConfig.apps.length;
    log.info(chalk.cyan(`\n◆ Batch mode: building ${total} app(s)...\n`));

    for (let i = 0; i < total; i++) {
      const app = batchConfig.apps[i];
      const appNum = i + 1;
      log.info(chalk.cyan(`\n━━━ [${appNum}/${total}] ${app.url} ━━━\n`));

      const mergedOptions: PakeCliOptions = {
        ...options,
        ...(batchConfig.sharedOptions || {}),
        ...(app.options || {}),
        ...(app.name ? { name: app.name } : {}),
      };
      // Remove batch flag to avoid recursion
      delete (mergedOptions as any).batch;

      try {
        await buildSingleApp(app.url, mergedOptions);
        log.info(chalk.green(`✔ [${appNum}/${total}] Done: ${app.url}\n`));
      } catch (error) {
        log.error(chalk.red(`✕ [${appNum}/${total}] Failed: ${app.url}`));
        log.error(String(error));
      }
    }

    log.info(chalk.green(`\n◆ Batch complete: ${total} app(s) processed.\n`));
    return;
  }

  // Handle --load-profile: load options from a saved profile
  if (options.loadProfile) {
    const profile = await loadProfile(options.loadProfile);
    if (!profile) {
      log.error(`✕ Profile "${options.loadProfile}" not found.`);
      process.exit(1);
    }
    log.info(chalk.cyan(`◆ Loaded profile "${profile.name}" (URL: ${profile.url})`));

    const mergedOptions = mergeProfileOptions(options, profile.options);
    const targetUrl = url || profile.url;
    await buildSingleApp(targetUrl, mergedOptions);
    return;
  }

  if (!url) {
    program.help({ error: false });
    return;
  }

  // Handle --save-profile: save current options as a profile
  if (options.saveProfile) {
    await saveProfile(options.saveProfile, url, options);
  }

  await buildSingleApp(url, options);
});

// Subcommand: list profiles
program
  .command('profiles')
  .description('List all saved profiles')
  .action(async () => {
    const profiles = await listProfiles();
    if (profiles.length === 0) {
      log.info('No profiles saved yet. Use --save-profile <name> to create one.');
      return;
    }
    log.info(chalk.cyan(`\n◆ Saved Profiles (${profiles.length}):\n`));
    for (const p of profiles) {
      const changed = Object.keys(p.options).length;
      log.info(`  ${chalk.green(p.name)} — ${p.url} (${changed} custom option${changed !== 1 ? 's' : ''})`);
    }
    log.info('');
  });

// Subcommand: delete a profile
program
  .command('profile-delete <name>')
  .description('Delete a saved profile')
  .action(async (name: string) => {
    await deleteProfile(name);
  });

program.parse();
