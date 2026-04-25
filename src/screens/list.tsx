import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import stringWidth from 'string-width';
import type { CliConfig } from '../config.js';
import { searchNotes, archiveNote, type NoteSearchResult } from '../github.js';
import { copyToClipboard } from '../clipboard.js';
import { logInfo, logError } from '../logger.js';

interface Props {
  config: CliConfig;
  onOpenNote: (note: NoteSearchResult) => void;
  onNewNote: (owner: string, repo: string) => void;
  onSettings: () => void;
}

// Column layout constants
const NUM_W = 5;
const DATE_W = 7;
const SEP = ' │ ';

function fitCol(text: string, width: number): string {
  const sw = stringWidth(text);
  if (sw <= width) return text + ' '.repeat(width - sw);
  let truncated = text;
  while (stringWidth(truncated) > width - 3 && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  const pad = width - stringWidth(truncated) - 3;
  return truncated + '...' + (pad > 0 ? ' '.repeat(pad) : '');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mon = d.toLocaleString('en', { month: 'short' });
  const day = String(d.getDate()).padStart(2);
  return `${mon} ${day}`;
}

export function ListScreen({ config, onOpenNote, onNewNote, onSettings }: Props) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const termHeight = stdout?.rows ?? 24;

  const [notes, setNotes] = useState<NoteSearchResult[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<NoteSearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState<string>('yellow');
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Rows available for notes (minus header, divider, footer, borders)
  const maxVisible = Math.max(1, termHeight - 5);

  // Column widths — fixed columns first, title gets the rest
  const REPO_W = 20;
  const fixedCols = 1 + NUM_W + SEP.length + DATE_W + SEP.length + REPO_W + SEP.length;

  function showStatus(msg: string, color = 'yellow') {
    setStatus(msg);
    setStatusColor(color);
  }

  async function fetchNotes() {
    showStatus('Loading...');
    logInfo('Note list: Fetching notes');
    try {
      let results = await searchNotes(config.host, config.token);

      if (config.pinnedIssue) {
        const pin = config.pinnedIssue;
        results.sort((a, b) => {
          const aPin = a.owner === pin.owner && a.repo === pin.repo && a.number === pin.number;
          const bPin = b.owner === pin.owner && b.repo === pin.repo && b.number === pin.number;
          return aPin ? -1 : bPin ? 1 : 0;
        });
      }

      setNotes(results);
      setFilteredNotes(results);
      setSelectedIdx(0);
      setVisibleStart(0);
      showStatus('', 'green');
      logInfo(`Note list: Loaded ${results.length} notes`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showStatus(`Error: ${msg}`, 'red');
      logError(`Note list: Failed to load notes: ${msg}`);
    }
  }

  useEffect(() => { fetchNotes(); }, []);

  function moveTo(idx: number) {
    if (idx < 0 || idx >= filteredNotes.length) return;
    setSelectedIdx(idx);
    if (idx < visibleStart) setVisibleStart(idx);
    if (idx >= visibleStart + maxVisible) setVisibleStart(idx - maxVisible + 1);
  }

  function issueUrl(note: NoteSearchResult): string {
    const base = config.host === 'github.com' ? 'https://github.com' : `https://${config.host}`;
    return `${base}/${note.owner}/${note.repo}/issues/${note.number}`;
  }

  function applySearch(query: string) {
    setSearchQuery(query);
    if (!query) {
      setFilteredNotes(notes);
    } else {
      const q = query.toLowerCase();
      setFilteredNotes(notes.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.body ?? '').toLowerCase().includes(q)
      ));
    }
    setSelectedIdx(0);
    setVisibleStart(0);
  }

  async function doDelete() {
    const note = filteredNotes[selectedIdx];
    if (!note) return;
    logInfo(`Note list: Deleting note #${note.number}: "${note.title}"`);
    showStatus('Deleting...');
    try {
      await archiveNote(config.host, config.token, note.owner, note.repo, note.number);
      logInfo(`Note list: Deleted note #${note.number}`);
      showStatus('Deleted', 'green');
      setConfirmDelete(false);
      await fetchNotes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Note list: Delete failed for #${note.number}: ${msg}`);
      showStatus(`Delete failed: ${msg}`, 'red');
      setConfirmDelete(false);
    }
  }

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        doDelete();
      } else {
        setConfirmDelete(false);
        showStatus('');
      }
      return;
    }

    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        applySearch('');
      } else if (key.return) {
        setSearchMode(false);
      } else if (key.backspace || key.delete) {
        applySearch(searchQuery.slice(0, -1));
      } else if (input && !key.ctrl) {
        applySearch(searchQuery + input);
      }
      return;
    }

    if (key.ctrl && input === 'd') moveTo(Math.min(selectedIdx + Math.floor(maxVisible / 2), filteredNotes.length - 1));
    else if (key.ctrl && input === 'u') moveTo(Math.max(selectedIdx - Math.floor(maxVisible / 2), 0));
    else if (input === 'j' || key.downArrow) moveTo(selectedIdx + 1);
    else if (input === 'k' || key.upArrow) moveTo(selectedIdx - 1);
    else if (key.return) {
      const note = filteredNotes[selectedIdx];
      if (note) onOpenNote(note);
    }
    else if (input === 'n') {
      const [owner, repo] = config.defaultRepo.split('/');
      onNewNote(owner, repo);
    }
    else if (input === 'r') fetchNotes();
    else if (input === '/') {
      setSearchMode(true);
      setSearchQuery('');
    }
    else if (input === 'd' && !key.ctrl) {
      if (filteredNotes[selectedIdx]) {
        setConfirmDelete(true);
        showStatus(`Delete "${filteredNotes[selectedIdx].title}"? (y/n)`, 'red');
      }
    }
    else if (input === 'y') {
      const note = filteredNotes[selectedIdx];
      if (note) {
        const ok = copyToClipboard(issueUrl(note));
        showStatus(ok ? 'Copied URL' : 'Clipboard not available', ok ? 'green' : 'red');
      }
    }
    else if (input === 's') onSettings();
    else if (input === 'q') process.exit(0);
  });

  // Visible slice
  const visible = filteredNotes.slice(visibleStart, visibleStart + maxVisible);
  const selected = filteredNotes[selectedIdx] ?? null;

  // Header row: # | Repo | Updated | Title (title last — emoji can't misalign fixed cols)
  const headerLine = ` ${'#'.padStart(NUM_W)}${SEP}${fitCol('Repo', REPO_W)}${SEP}${fitCol('Updated', DATE_W)}${SEP}Title`;
  const divider = '─'.repeat(termWidth);

  return (
    <Box flexDirection="column">
      {/* Title bar — shows issue URL for selected note, or transient status */}
      <Box>
        <Text backgroundColor="blue" color={status ? statusColor as any : 'white'} bold>
          {fitCol(status || (selected ? ' ' + issueUrl(selected) : ' notehub-cli'), termWidth)}
        </Text>
      </Box>

      {/* Search bar */}
      {searchMode && (
        <Box>
          <Text color="yellow">/ </Text>
          <Text>{searchQuery}</Text>
          <Text dimColor>█</Text>
        </Box>
      )}

      {/* Column header */}
      <Text dimColor>{headerLine}</Text>
      <Text dimColor>{divider}</Text>

      {/* Note rows */}
      {visible.map((n, i) => {
        const idx = visibleStart + i;
        const isSelected = idx === selectedIdx;
        const num = String(n.number).padStart(NUM_W);
        const repo = fitCol(`${n.owner}/${n.repo}`, REPO_W);
        const date = fitCol(formatDate(n.updated_at), DATE_W);
        const line = ` ${num}${SEP}${repo}${SEP}${date}${SEP}${n.title}`;

        return (
          <Text
            key={`${visibleStart + i}`}
            backgroundColor={isSelected ? 'blue' : undefined}
            color={isSelected ? 'white' : undefined}
            bold={isSelected}
          >
            {line}
          </Text>
        );
      })}

      {filteredNotes.length === 0 && (
        <Text dimColor> No notes found.</Text>
      )}

      {/* Footer */}
      <Box marginTop={0}>
        <Text backgroundColor="white" color="black">
          {fitCol(' j/k:Nav  ^D/^U:Page  Enter:Open  n:New  r:Refresh  /:Search  d:Del  y:CopyURL  s:Settings  q:Quit', termWidth)}
        </Text>
      </Box>
    </Box>
  );
}
