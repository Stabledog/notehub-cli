import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import { loadConfig, saveConfig, type CliConfig } from './config.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { SettingsScreen } from './screens/settings.js';
import { ListScreen } from './screens/list.js';
import { openNote, openNewNote, type EditResult } from './screens/editor.js';
import {
  searchNotes, getNote, updateNote, createNote, archiveNote,
  getAttachmentsRepoInfo, listAttachments, uploadAttachment,
  deleteAttachment, fetchAttachmentBlob, rawContentUrl,
  type NoteSearchResult,
} from './github.js';

// Replaced by esbuild --define at bundle time; falls back to package.json for dev.
// (The fallback must be require()-free: unbundled tsc output runs as ESM.)
declare const __CLI_VERSION__: string | undefined;
const CLI_VERSION: string = (() => {
  if (typeof __CLI_VERSION__ !== 'undefined') return __CLI_VERSION__;
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  return pkg.version;
})();

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`notehub-cli ${CLI_VERSION}`);
  process.exit(0);
}

// ── Agent CLI (no TTY required) ───────────────────────────────────────────────
// Subcommands for programmatic / AI-agent access.  These run before Ink starts
// so they work without a terminal and exit cleanly.
//
// notehub-cli.mjs list [--json]
// notehub-cli.mjs get <number|owner/repo#number> [--json]
// notehub-cli.mjs set <number|owner/repo#number> [--title "..."] [--body "..."|--stdin]
// notehub-cli.mjs create --title "..." [--body "..."|--stdin]
// notehub-cli.mjs archive <number|owner/repo#number>
// notehub-cli.mjs search <query> [--json]
// notehub-cli.mjs attach <number|owner/repo#number> --file <path> [--as-name <name>]
// notehub-cli.mjs attachments <number|owner/repo#number> [--json]
// notehub-cli.mjs download <number|owner/repo#number> --name <name> [--out <path>]
// notehub-cli.mjs detach <number|owner/repo#number> --name <name>

const AGENT_CMDS = new Set([
  'list', 'get', 'set', 'create', 'archive',
  'search', 'attach', 'attachments', 'download', 'detach',
]);
const agentCmd = process.argv[2];

if (agentCmd && AGENT_CMDS.has(agentCmd)) {
  runAgentCommand(agentCmd, process.argv.slice(3))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
} else {
  startTUI();
}

// ── Agent command implementation ──────────────────────────────────────────────

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseNoteRef(
  ref: string,
  defaultOwner: string,
  defaultRepo: string,
): { owner: string; repo: string; number: number } {
  const complex = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (complex) {
    return { owner: complex[1], repo: complex[2], number: parseInt(complex[3], 10) };
  }
  const n = parseInt(ref, 10);
  if (!isNaN(n) && String(n) === ref) {
    return { owner: defaultOwner, repo: defaultRepo, number: n };
  }
  throw new Error(`Invalid note reference: "${ref}". Use a number or "owner/repo#number".`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function printNoteRow(n: NoteSearchResult): void {
  const updated = n.updated_at.slice(0, 10);
  process.stdout.write(
    `${String(n.number).padStart(5)}  ${(n.owner + '/' + n.repo).padEnd(30)}  ${updated}  ${n.title}\n`,
  );
}

function printSnippet(n: NoteSearchResult, query: string): void {
  const hay = `${n.title}\n${n.body ?? ''}`;
  const i = hay.toLowerCase().indexOf(query.toLowerCase());
  if (i >= 0) {
    const snippet = hay.slice(Math.max(0, i - 60), i + 120).replace(/\n/g, ' ');
    process.stdout.write(`      ...${snippet}...\n`);
  }
}

// searchNotes() in github.ts takes no query; this variant does. Kept local
// because github.ts is shared with notehub.web (symlinked, not ours to edit).
async function searchNotesQuery(
  host: string, token: string, query: string,
): Promise<NoteSearchResult[]> {
  const base = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const q = encodeURIComponent(`${query} is:issue label:notehub state:open archived:false`);
  const res = await fetch(
    `${base}/search/issues?q=${q}&sort=updated&order=desc&per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    items: (NoteSearchResult & { repository_url: string })[];
  };
  return data.items.map(item => {
    // repository_url looks like https://{host}/api/v3/repos/{owner}/{repo}
    const parts = item.repository_url.split('/');
    const repo = parts.pop()!;
    const owner = parts.pop()!;
    return { ...item, owner, repo };
  });
}

async function runAgentCommand(cmd: string, argv: string[]): Promise<void> {
  const config = loadConfig();
  if (!config) {
    process.stderr.write(
      'notehub-cli: not configured. Run without subcommand to set up interactively.\n',
    );
    process.exit(1);
  }

  const { host, token, defaultRepo } = config;
  const [defaultOwner, defaultRepoName] = defaultRepo.split('/');
  const { positional, flags } = parseFlags(argv);

  switch (cmd) {
    case 'list': {
      const notes = await searchNotes(host, token);
      if (flags['json']) {
        process.stdout.write(JSON.stringify(notes, null, 2) + '\n');
      } else {
        for (const n of notes) printNoteRow(n);
      }
      break;
    }

    case 'search': {
      const query = positional[0];
      if (!query) throw new Error('Usage: search <query> [--json]');
      const notes = await searchNotesQuery(host, token, query);
      if (flags['json']) {
        process.stdout.write(JSON.stringify(notes, null, 2) + '\n');
      } else {
        for (const n of notes) {
          printNoteRow(n);
          printSnippet(n, query);
        }
        if (notes.length === 0) process.stderr.write('no matches\n');
      }
      break;
    }

    case 'get': {
      const ref = positional[0];
      if (!ref) throw new Error('Usage: get <number|owner/repo#number> [--json]');
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const note = await getNote(host, token, owner, repo, number);
      if (flags['json']) {
        process.stdout.write(JSON.stringify(note, null, 2) + '\n');
      } else {
        process.stdout.write(`${note.title}\n---\n${note.body ?? ''}\n`);
      }
      break;
    }

    case 'set': {
      const ref = positional[0];
      if (!ref) throw new Error('Usage: set <number|owner/repo#number> [--title "..."] [--body "..."|--stdin]');
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const data: { title?: string; body?: string } = {};
      if (typeof flags['title'] === 'string') data.title = flags['title'];
      if (flags['stdin']) {
        data.body = await readStdin();
      } else if (typeof flags['body'] === 'string') {
        data.body = flags['body'];
      }
      if (Object.keys(data).length === 0) {
        throw new Error('set: provide at least --title or --body (or --stdin for body from stdin)');
      }
      await updateNote(host, token, owner, repo, number, data);
      process.stdout.write(`Updated ${owner}/${repo}#${number}\n`);
      break;
    }

    case 'create': {
      const title = flags['title'];
      if (!title || typeof title !== 'string') {
        throw new Error('Usage: create --title "..." [--body "..."|--stdin]');
      }
      let body = '';
      if (flags['stdin']) {
        body = await readStdin();
      } else if (typeof flags['body'] === 'string') {
        body = flags['body'];
      }
      const created = await createNote(host, token, defaultOwner, defaultRepoName, title, body);
      process.stdout.write(JSON.stringify({ number: created.number, title: created.title }) + '\n');
      break;
    }

    case 'archive': {
      const ref = positional[0];
      if (!ref) throw new Error('Usage: archive <number|owner/repo#number>');
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      await archiveNote(host, token, owner, repo, number);
      process.stdout.write(`Archived ${owner}/${repo}#${number}\n`);
      break;
    }

    case 'attach': {
      const ref = positional[0];
      const file = flags['file'];
      if (!ref || typeof file !== 'string') {
        throw new Error('Usage: attach <number|owner/repo#number> --file <path> [--as-name <name>]');
      }
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const filename = typeof flags['as-name'] === 'string'
        ? flags['as-name'] : file.split('/').pop()!;
      if (filename.includes('/')) throw new Error(`bad attachment filename: "${filename}"`);
      const { owner: attachOwner, repo: attachRepo } = getAttachmentsRepoInfo(defaultRepo);
      const content = readFileSync(file).toString('base64');
      // Re-uploading the same name replaces it (pass the existing sha)
      const existing = await listAttachments(host, token, attachOwner, attachRepo, owner, repo, number);
      const prev = existing.find(a => a.name === filename);
      const att = await uploadAttachment(
        host, token, attachOwner, attachRepo, owner, repo, number,
        filename, content, prev?.sha,
      );
      process.stdout.write(`attached ${att.path} to ${owner}/${repo}#${number}\n`);
      process.stdout.write(rawContentUrl(host, attachOwner, attachRepo, att.path) + '\n');
      break;
    }

    case 'attachments': {
      const ref = positional[0];
      if (!ref) throw new Error('Usage: attachments <number|owner/repo#number> [--json]');
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const { owner: attachOwner, repo: attachRepo } = getAttachmentsRepoInfo(defaultRepo);
      const atts = await listAttachments(host, token, attachOwner, attachRepo, owner, repo, number);
      if (flags['json']) {
        process.stdout.write(JSON.stringify(atts, null, 2) + '\n');
      } else if (atts.length === 0) {
        process.stdout.write('(no attachments)\n');
      } else {
        for (const a of atts) process.stdout.write(`${a.name}  (${a.size} bytes)\n`);
      }
      break;
    }

    case 'download': {
      const ref = positional[0];
      const name = flags['name'];
      if (!ref || typeof name !== 'string') {
        throw new Error('Usage: download <number|owner/repo#number> --name <name> [--out <path>]');
      }
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const { owner: attachOwner, repo: attachRepo } = getAttachmentsRepoInfo(defaultRepo);
      const { blob, filename } = await fetchAttachmentBlob(
        host, token, attachOwner, attachRepo, `${owner}/${repo}/${number}/${name}`,
      );
      const out = typeof flags['out'] === 'string' ? flags['out'] : filename;
      writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
      process.stdout.write(`wrote ${out}\n`);
      break;
    }

    case 'detach': {
      const ref = positional[0];
      const name = flags['name'];
      if (!ref || typeof name !== 'string') {
        throw new Error('Usage: detach <number|owner/repo#number> --name <name>');
      }
      const { owner, repo, number } = parseNoteRef(ref, defaultOwner, defaultRepoName);
      const { owner: attachOwner, repo: attachRepo } = getAttachmentsRepoInfo(defaultRepo);
      const atts = await listAttachments(host, token, attachOwner, attachRepo, owner, repo, number);
      const att = atts.find(a => a.name === name);
      if (!att) throw new Error(`no attachment named "${name}" on ${owner}/${repo}#${number}`);
      await deleteAttachment(host, token, attachOwner, attachRepo, att.path, att.sha);
      process.stdout.write(`removed ${att.path}\n`);
      break;
    }
  }
}

// ── Interactive TUI ───────────────────────────────────────────────────────────

type Screen =
  | { type: 'settings' }
  | { type: 'list' }
  | { type: 'message'; text: string; color: string };

function App({ initialConfig }: { initialConfig: CliConfig | null }) {
  const [config, setConfig] = useState<CliConfig | null>(initialConfig);
  const [screen, setScreen] = useState<Screen>(
    initialConfig ? { type: 'list' } : { type: 'settings' },
  );

  const handleSettingsComplete = useCallback((newConfig: CliConfig) => {
    saveConfig(newConfig);
    setConfig(newConfig);
    setScreen({ type: 'list' });
  }, []);

  const handleOpenNote = useCallback((note: NoteSearchResult) => {
    if (!config) return;
    // Unmount Ink, spawn editor, remount
    instance.unmount();
    openNote(config, note).then((result) => {
      if (result.action === 'error' && result.message) {
        process.stderr.write(`\n${result.message}\n\n`);
      }
      instance = startApp(config);
    });
  }, [config]);

  const handleNewNote = useCallback((owner: string, repo: string) => {
    if (!config) return;
    instance.unmount();
    openNewNote(config, owner, repo).then((_result) => {
      instance = startApp(config);
    });
  }, [config]);

  if (screen.type === 'settings') {
    return (
      <SettingsScreen
        existing={config}
        onComplete={handleSettingsComplete}
      />
    );
  }

  if (screen.type === 'list' && config) {
    return (
      <ListScreen
        config={config}
        onOpenNote={handleOpenNote}
        onNewNote={handleNewNote}
        onSettings={() => setScreen({ type: 'settings' })}
      />
    );
  }

  return null;
}

function startApp(config: CliConfig | null) {
  // Clear terminal so the new Ink instance doesn't render below stale content
  process.stdout.write('\x1B[2J\x1B[H');
  return render(<App initialConfig={config} />);
}

// module-level so handleOpenNote/handleNewNote callbacks can reassign it
let instance: ReturnType<typeof render>;

function startTUI() {
  instance = startApp(loadConfig());

  process.on('SIGINT', () => {
    instance.unmount();
    process.exit(0);
  });
}
