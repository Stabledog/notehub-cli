import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MAX_LINES = 1000;

function getLogPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), '.config');
  const dir = join(base, 'notehub');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'debug.log');
}

let logPath: string | undefined;

function ensurePath(): string {
  if (!logPath) logPath = getLogPath();
  return logPath;
}

function formatTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function writeLine(level: string, message: string): void {
  const line = `[${formatTime()}] ${level}: ${message}\n`;
  const path = ensurePath();
  try {
    appendFileSync(path, line);
  } catch {
    return;
  }

  // Trim to MAX_LINES periodically — check file size as a rough heuristic
  try {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > MAX_LINES + 100) {
      writeFileSync(path, lines.slice(-MAX_LINES).join('\n'));
    }
  } catch {
    // best-effort
  }
}

export function logError(message: string): void {
  writeLine('ERROR', message);
}

export function logWarn(message: string): void {
  writeLine('WARN', message);
}

export function logInfo(message: string): void {
  writeLine('INFO', message);
}

export function logDebug(message: string): void {
  writeLine('DEBUG', message);
}
