# notehub-cli Feature Parity Updates

Features present in notehub.web but missing from notehub-cli.  *(Commit hashes refer to the notehub-web repo, which was used as the seed source for feature discrepancies between web and cli)*

## HI priority

| name | description |
|------|-------------|
| `regex-search` | notehub.web has a rich search with regex toggle (`Ctrl+R`), context snippets with highlighted matches, and match counts. The CLI's `/` search only does simple case-insensitive substring matching on title+body, with no regex support and no context preview. Web commit: `fb07010`. CLI effort: Medium — extend existing `/` mode. |
| `copy-url-menu` | notehub.web offers both a "Notehub URL" and "GitHub URL" option from the copy button. The CLI's `y` keybinding only copies the GitHub issue URL. Web commit: `275bdc5`. CLI effort: Small — add second copy keybinding. |
| `conflict-dialog` | notehub.web shows an interactive "Overwrite/Cancel" dialog when a save conflict is detected. The CLI detects conflicts (`editor.ts:135-145`) but has a `// TODO: expose conflict to caller` and silently proceeds. Web commit: `65e913c`. CLI effort: Small — prompt y/n before overwrite. |
| `auto-save` | notehub.web uses veditor's `getAutoSaveMs()` for periodic auto-save. The CLI relies entirely on manual save-on-editor-exit. Solution: CLI should monitor file state in background to detect changes while editor is running, auto-save on 5 sec intervals. No keystroke debounce timeouts. Web commit: `bb4c4d8`. CLI effort: Medium — background file watcher. |
| `repo-picker` | notehub.web presents a picker of all repos where notes exist, plus an "Other" field, when creating a new note. The CLI always creates in `config.defaultRepo` with no override. Web ref: `showRepoPicker()`. CLI effort: Medium — Ink overlay or menu. |
| `repo-validation` | notehub.web calls `repoExists()` and shows an alert if the repo doesn't exist before opening a new note editor. The CLI doesn't check. Web commit: `1cb71f7`. CLI effort: Small — one `repoExists()` call. |
| `attachment-badges` | notehub.web asynchronously loads attachment counts and shows paperclip badges in the note list. CLI has no equivalent. Web commits: `e9e0056`, `a6ad81f`. CLI effort: Small — async badge fetch after list loads. |

## MEDIUM priority

| name | description |
|------|-------------|
| `url-routing` | notehub.web supports URL routing (`#/edit/owner/repo/123`) enabling deep links to specific notes. The CLI has no equivalent "open a specific note by ID" argument. Web commit: `b2bcd88`. CLI effort: Small — CLI arg parsing. |
| `open-on-github` | notehub.web has a context menu per row with an "Edit on GitHub" option that opens the issue in the browser. The CLI has `d` for delete but no shortcut to open the current note on GitHub. CLI effort: Small — new keybinding to `open`. |

## Attachment panel sub-features

Attachments are stored in a sibling `.attachments` repo. The CLI's `github.ts`
already has the API functions but no UI exposes them. Web commits: `e9e0056`,
`eb8ddc8`, `d98cb37`, `563787d`, `a6ad81f`, `3484b46`.

| name | description |
|------|-------------|
| `attachment-upload-download` | **[a]** Core attachment operations: upload files to the `.attachments` repo and download them back. CLI effort: Large — needs a TUI attachment panel. |
| `attachment-preview` | **[b]** Open/display attachment content in-terminal or via `$PAGER` / a temp file. CLI effort: Medium — extend attachment UI after `attachment-upload-download`. |
| `attachment-multi-delete` | **[c]** Batch deletion with checkbox-style multi-selection before confirming delete. CLI effort: Medium — extend attachment UI. |
