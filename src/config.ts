import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CliConfig {
  host: string;
  token: string;
  defaultRepo: string;  // "owner/repo"
  pinnedIssue?: { owner: string; repo: string; number: number };
}

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), '.config');
  return join(base, 'notehub');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): CliConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.host || !parsed.token || !parsed.defaultRepo) return null;
    return parsed as CliConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  const path = getConfigPath();
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}
