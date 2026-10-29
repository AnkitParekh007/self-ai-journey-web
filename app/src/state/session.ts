// The credential boundary. A GitHub token is held ONLY in this module's memory:
// never in React state snapshots, IndexedDB, localStorage, exports, URLs or logs.
// A page reload forgets it by design; the user reconnects.
import { createGitHubRemote, looksLikeGitHubToken, type GitHubTarget } from '@core/remote-github';
import { createLocalRepoRemote } from '@core/remote-http';
import type { RemoteStore } from '@core/sync';
import { createDirectoryRemote, pickDirectory } from '../storage/remote-directory';
import type { AppStore } from './store';

type GitHubRemote = ReturnType<typeof createGitHubRemote>;
let github: GitHubRemote | null = null;
let githubTarget: GitHubTarget | null = null;
let githubToken: string | null = null; // memory only

export async function connectGitHub(store: AppStore, target: GitHubTarget, token: string): Promise<void> {
  const t = token.trim();
  if (!looksLikeGitHubToken(t)) throw new Error('That does not look like a GitHub token (expected github_pat_… or ghp_…).');
  const remote = createGitHubRemote(target, t);
  await remote.verifyWritable(); // owner/name match + private, before anything else
  github?.disconnect();
  github = remote;
  githubTarget = target;
  githubToken = t;
  store.setRemote(remote);
  await store.local.setMeta('githubTarget', target); // coordinates only, never the token
}

export function connectLocalRepo(store: AppStore) {
  disconnect(store);
  store.setRemote(createLocalRepoRemote());
}

export async function connectDirectory(store: AppStore) {
  const handle = await pickDirectory();
  const remote: RemoteStore = createDirectoryRemote(handle);
  await remote.verifyWritable();
  disconnect(store);
  store.setRemote(remote);
}

/** Forget the credential. Cached records stay on this device until "Clear local data". */
export function disconnect(store: AppStore) {
  github?.disconnect();
  github = null;
  githubToken = null;
  store.setRemote(null);
}

export function githubConnected(): GitHubTarget | null {
  return github?.isConnected() ? githubTarget : null;
}

/** Download a non-JSON repository file (e.g. a rendered PDF) through the active connection. */
export async function fetchRepoFile(path: string): Promise<Blob> {
  const token = githubToken;
  if (!/^applications\/[A-Za-z0-9._/-]+$/.test(path) || path.includes('..')) throw new Error('only files under applications/ can be downloaded');
  if (githubTarget && github?.isConnected() && token) {
    const res = await fetch(`https://api.github.com/repos/${githubTarget.owner}/${githubTarget.repo}/contents/${path}?ref=${githubTarget.branch}`, {
      headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    return res.blob();
  }
  const res = await fetch(`/__repo/file?path=${encodeURIComponent(path)}`, { headers: { 'X-Repo-Bridge': '1' } });
  if (!res.ok) throw new Error('Downloads need the local dev server (npm run dev) or the CLI. Files live in your private repository.');
  return res.blob();
}
