import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import { loadConfig, saveConfig, type CliConfig } from './config.js';
import { SettingsScreen } from './screens/settings.js';
import { ListScreen } from './screens/list.js';
import { openNote, openNewNote, type EditResult } from './screens/editor.js';
import type { NoteSearchResult } from './github.js';

// Replaced by esbuild --define at bundle time; falls back to package.json for dev
declare const __CLI_VERSION__: string | undefined;
const CLI_VERSION: string = typeof __CLI_VERSION__ !== 'undefined'
  ? __CLI_VERSION__
  : require('../package.json').version;

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`notehub-cli ${CLI_VERSION}`);
  process.exit(0);
}

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

let instance = startApp(loadConfig());

// Handle graceful exit
process.on('SIGINT', () => {
  instance.unmount();
  process.exit(0);
});
