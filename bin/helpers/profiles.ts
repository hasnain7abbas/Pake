import path from 'path';
import os from 'os';
import fsExtra from 'fs-extra';
import logger from '@/options/logger';
import { PakeCliOptions } from '@/types';
import { DEFAULT_PAKE_OPTIONS } from '@/defaults';

const PROFILES_DIR = path.join(os.homedir(), '.pake', 'profiles');

export interface PakeProfile {
  name: string;
  url: string;
  options: Partial<PakeCliOptions>;
  createdAt: string;
  updatedAt: string;
}

export interface BatchConfig {
  apps: Array<{
    url: string;
    name?: string;
    options?: Partial<PakeCliOptions>;
  }>;
  sharedOptions?: Partial<PakeCliOptions>;
}

async function ensureProfilesDir(): Promise<void> {
  await fsExtra.ensureDir(PROFILES_DIR);
}

export async function saveProfile(
  profileName: string,
  url: string,
  options: PakeCliOptions,
): Promise<string> {
  await ensureProfilesDir();

  const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
  const existing = await loadProfile(profileName);

  const profile: PakeProfile = {
    name: profileName,
    url,
    options: getChangedOptions(options),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await fsExtra.writeJson(filePath, profile, { spaces: 2 });
  logger.success(`✔ Profile "${profileName}" saved to ${filePath}`);
  return filePath;
}

export async function loadProfile(
  profileName: string,
): Promise<PakeProfile | null> {
  await ensureProfilesDir();

  const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
  if (!(await fsExtra.pathExists(filePath))) {
    return null;
  }

  return fsExtra.readJson(filePath);
}

export async function deleteProfile(profileName: string): Promise<boolean> {
  await ensureProfilesDir();

  const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
  if (!(await fsExtra.pathExists(filePath))) {
    logger.error(`✕ Profile "${profileName}" not found.`);
    return false;
  }

  await fsExtra.remove(filePath);
  logger.success(`✔ Profile "${profileName}" deleted.`);
  return true;
}

export async function listProfiles(): Promise<PakeProfile[]> {
  await ensureProfilesDir();

  const files = await fsExtra.readdir(PROFILES_DIR);
  const profiles: PakeProfile[] = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(PROFILES_DIR, file);
      const profile = await fsExtra.readJson(filePath);
      profiles.push(profile);
    }
  }

  return profiles;
}

export async function loadBatchConfig(
  configPath: string,
): Promise<BatchConfig> {
  const fullPath = path.resolve(configPath);
  if (!(await fsExtra.pathExists(fullPath))) {
    throw new Error(`Batch config file not found: ${fullPath}`);
  }

  const config: BatchConfig = await fsExtra.readJson(fullPath);

  if (!config.apps || !Array.isArray(config.apps) || config.apps.length === 0) {
    throw new Error(
      'Batch config must contain an "apps" array with at least one entry.',
    );
  }

  for (const app of config.apps) {
    if (!app.url) {
      throw new Error('Each app in the batch config must have a "url" field.');
    }
  }

  return config;
}

export function mergeProfileOptions(
  cliOptions: PakeCliOptions,
  profileOptions: Partial<PakeCliOptions>,
): PakeCliOptions {
  return { ...cliOptions, ...profileOptions };
}

function getChangedOptions(
  options: PakeCliOptions,
): Partial<PakeCliOptions> {
  const changed: Partial<PakeCliOptions> = {};
  const defaults = DEFAULT_PAKE_OPTIONS;

  for (const key of Object.keys(options) as Array<keyof PakeCliOptions>) {
    if (key === 'name' || key === 'identifier' || key === 'title') continue;
    const current = options[key];
    const defaultVal = defaults[key];
    if (JSON.stringify(current) !== JSON.stringify(defaultVal)) {
      (changed as any)[key] = current;
    }
  }

  return changed;
}
