import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CliConfig } from '../config.js';
import { validateToken } from '../github.js';
import { logInfo, logError } from '../logger.js';

interface Props {
  existing: CliConfig | null;
  onComplete: (config: CliConfig) => void;
}

interface Field {
  label: string;
  key: string;
  mask?: string;
  optional?: boolean;
  validate?: (value: string) => string | null; // returns error or null
}

const FIELDS: Field[] = [
  { label: 'GitHub Host', key: 'host' },
  { label: 'Personal Access Token', key: 'token', mask: '*' },
  {
    label: 'Default Repository (owner/repo)',
    key: 'defaultRepo',
    validate: (v) => v.includes('/') ? null : 'Format: owner/repo',
  },
  {
    label: 'Default Note number (optional)',
    key: 'pinnedIssue',
    optional: true,
    validate: (v) => !v || /^\d+$/.test(v) ? null : 'Enter a number',
  },
];

export function SettingsScreen({ existing, onComplete }: Props) {
  const defaults: Record<string, string> = {
    host: existing?.host ?? 'github.com',
    token: existing?.token ?? '',
    defaultRepo: existing?.defaultRepo ?? '',
    pinnedIssue: existing?.pinnedIssue?.number?.toString() ?? '',
  };

  const [fieldIdx, setFieldIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [currentValue, setCurrentValue] = useState(defaults[FIELDS[0].key] ?? '');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [validating, setValidating] = useState(false);

  const field = FIELDS[fieldIdx];

  useInput((_input, key) => {
    if (key.escape && fieldIdx > 0) {
      const prevIdx = fieldIdx - 1;
      setFieldIdx(prevIdx);
      setCurrentValue(values[FIELDS[prevIdx].key] ?? '');
      setError('');
    } else if (key.escape && existing) {
      onComplete(existing);
    }
  });

  function handleSubmit(value: string) {
    const trimmed = value.trim();

    if (!field.optional && !trimmed) {
      setError('This field is required');
      return;
    }

    if (trimmed && field.validate) {
      const err = field.validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }

    setError('');
    const newValues = { ...values, [field.key]: trimmed };
    setValues(newValues);

    if (fieldIdx < FIELDS.length - 1) {
      const nextIdx = fieldIdx + 1;
      setFieldIdx(nextIdx);
      setCurrentValue(newValues[FIELDS[nextIdx].key] ?? '');
    } else {
      doSave(newValues);
    }
  }

  async function doSave(vals: Record<string, string>) {
    setValidating(true);
    setStatus('Validating token...');
    logInfo(`Settings: Validating token for host=${vals.host}`);

    try {
      const user = await validateToken(vals.host, vals.token);
      logInfo(`Settings: Token validated for user ${user.login} on ${vals.host}`);
      setStatus(`Authenticated as ${user.login}`);

      const [owner, repo] = vals.defaultRepo.split('/');
      const pinnedNum = vals.pinnedIssue ? parseInt(vals.pinnedIssue, 10) : null;
      const pinnedIssue = pinnedNum ? { owner, repo, number: pinnedNum } : undefined;

      onComplete({
        host: vals.host,
        token: vals.token,
        defaultRepo: vals.defaultRepo,
        pinnedIssue,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Settings: Token validation failed for host=${vals.host}: ${msg}`);
      setStatus(`Auth failed: ${msg}`);
      setValidating(false);
      // Go back to token field
      setFieldIdx(1);
      setCurrentValue(vals.token);
    }
  }

  // Completed fields
  const completedLines = FIELDS.slice(0, fieldIdx).map((f) => {
    const display = f.mask ? '********' : values[f.key];
    return (
      <Text key={f.key}>
        <Text color="green">{f.label}:</Text> {display}
      </Text>
    );
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>notehub-cli settings</Text>
      <Text> </Text>

      {completedLines}

      {!validating && (
        <Box flexDirection="column">
          <Text bold>{field.label}:</Text>
          <Box>
            <Text>&gt; </Text>
            <TextInput
              value={currentValue}
              onChange={setCurrentValue}
              onSubmit={handleSubmit}
              mask={field.mask}
            />
          </Box>
          {error && <Text color="red">{error}</Text>}
          <Text dimColor>Enter to continue, Escape to go back</Text>
        </Box>
      )}

      {status && (
        <Text color={status.startsWith('Auth failed') ? 'red' : 'yellow'}>
          {status}
        </Text>
      )}
    </Box>
  );
}
