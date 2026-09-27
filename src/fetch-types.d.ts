// notehub.web's github.ts (symlinked as src/github.ts) passes
// `cache: 'no-cache'` to fetch(). The RequestInit type in this repo's
// @types/node version doesn't declare it, so augment it here rather than
// touching the shared file.
interface RequestInit {
  cache?: 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload';
}
