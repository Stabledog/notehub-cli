import { spawnSync } from 'node:child_process';

const COMMANDS = [
  ['xclip', ['-selection', 'clipboard']],
  ['xsel', ['--clipboard', '--input']],
  ['wl-copy', []],
  ['pbcopy', []],
] as const;

function findClipboardCmd(): readonly [string, readonly string[]] | null {
  for (const [cmd, args] of COMMANDS) {
    const result = spawnSync('which', [cmd], { stdio: 'pipe' });
    if (result.status === 0) return [cmd, args];
  }
  return null;
}

let cachedCmd: readonly [string, readonly string[]] | null | undefined;

export function copyToClipboard(text: string): boolean {
  if (cachedCmd === undefined) {
    cachedCmd = findClipboardCmd();
  }
  if (!cachedCmd) return false;

  const [cmd, args] = cachedCmd;
  const result = spawnSync(cmd, [...args], { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
  return result.status === 0;
}
