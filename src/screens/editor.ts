import { spawnSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getNote, updateNote, createNote,
  type NoteSearchResult, type GitHubIssue,
} from '../github.js';
import type { CliConfig } from '../config.js';

const SEPARATOR = '---';

function getEditor(): string {
  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write(
      '\n$EDITOR is not set. Set it to your preferred editor, e.g.:\n' +
      '  export EDITOR=vim\n\n',
    );
    process.exit(1);
  }
  return editor;
}

function unixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function writeTempFile(title: string, body: string, suffix: string): string {
  const p = unixPath(join(tmpdir(), `notehub-${suffix}-${Date.now()}.md`));
  writeFileSync(p, `${title}\n${SEPARATOR}\n${body}`, 'utf-8');
  return p;
}

function parseTempFile(path: string): { title: string; body: string } | null {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }

  const sepIdx = content.indexOf(`\n${SEPARATOR}\n`);
  if (sepIdx === -1) {
    const lines = content.split('\n');
    return { title: lines[0] ?? '', body: lines.slice(1).join('\n') };
  }
  return {
    title: content.slice(0, sepIdx),
    body: content.slice(sepIdx + SEPARATOR.length + 2),
  };
}

function cleanupTempFile(path: string) {
  try { unlinkSync(path); } catch { /* ignore */ }
}

/** Spawn $EDITOR on a temp file. Returns a promise that resolves to success/failure. */
export function runEditor(tempPath: string): Promise<boolean> {
  const editor = getEditor();
  const shell = process.env.SHELL || process.env.BASH || true;

  // Fully release stdin before spawning — Ink puts it in raw mode
  // and attaches data listeners that steal keystrokes from the editor.
  const wasRaw = process.stdin.isRaw;
  if (wasRaw) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.removeAllListeners('data');

  return new Promise((resolve) => {
    const child = spawn(editor, [tempPath], {
      stdio: 'inherit',
      env: process.env,
      shell,
    });

    child.on('error', (err) => {
      process.stderr.write(
        `\nFailed to launch editor '${editor}': ${err.message}\n` +
        `  shell=${String(shell)}\n\n`,
      );
      resolve(false);
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

export interface EditResult {
  action: 'saved' | 'cancelled' | 'error';
  message?: string;
}

export async function openNote(
  config: CliConfig,
  note: NoteSearchResult,
): Promise<EditResult> {
  let fresh: GitHubIssue;
  try {
    fresh = await getNote(config.host, config.token, note.owner, note.repo, note.number);
  } catch (err) {
    return { action: 'error', message: `Failed to fetch: ${err instanceof Error ? err.message : err}` };
  }

  const originalUpdatedAt = fresh.updated_at;
  const tempPath = writeTempFile(fresh.title, fresh.body ?? '', String(note.number));

  const ok = await runEditor(tempPath);

  if (!ok) {
    cleanupTempFile(tempPath);
    return { action: 'error', message: 'Editor exited with error — changes discarded' };
  }

  const parsed = parseTempFile(tempPath);
  cleanupTempFile(tempPath);

  if (!parsed || !parsed.title.trim()) {
    return { action: 'cancelled', message: 'Empty title — changes discarded' };
  }

  if (parsed.title === fresh.title && parsed.body === (fresh.body ?? '')) {
    return { action: 'cancelled' };
  }

  // Conflict detection
  let conflict = false;
  try {
    const current = await getNote(config.host, config.token, note.owner, note.repo, note.number);
    conflict = current.updated_at !== originalUpdatedAt;
  } catch {
    // Can't check — proceed
  }

  if (conflict) {
    // Caller can prompt the user; for now, return info
    // TODO: expose conflict to caller for interactive resolution
  }

  try {
    const data: { title?: string; body?: string } = {};
    if (parsed.title !== fresh.title) data.title = parsed.title;
    if (parsed.body !== (fresh.body ?? '')) data.body = parsed.body;
    await updateNote(config.host, config.token, note.owner, note.repo, note.number, data);
    return { action: 'saved' };
  } catch (err) {
    return { action: 'error', message: `Save failed: ${err instanceof Error ? err.message : err}` };
  }
}

export async function openNewNote(
  config: CliConfig,
  owner: string,
  repo: string,
): Promise<EditResult> {
  const tempPath = writeTempFile('New note', '', 'new');

  const ok = await runEditor(tempPath);

  if (!ok) {
    cleanupTempFile(tempPath);
    return { action: 'error', message: 'Editor exited with error — note not created' };
  }

  const parsed = parseTempFile(tempPath);
  cleanupTempFile(tempPath);

  if (!parsed || !parsed.title.trim()) {
    return { action: 'cancelled', message: 'Empty title — note not created' };
  }

  try {
    await createNote(config.host, config.token, owner, repo, parsed.title, parsed.body);
    return { action: 'saved' };
  } catch (err) {
    return { action: 'error', message: `Create failed: ${err instanceof Error ? err.message : err}` };
  }
}
