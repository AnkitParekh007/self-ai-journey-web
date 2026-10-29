// Browser client for the local-repo bridge served by `npm run dev` (localhost only).
// It talks to scripts/lib/fs-store.ts through app/repo-bridge.ts with the same contract as GitHub.
import type { CommitResult, RemoteChange, RemoteInfo, RemoteSnapshot, RemoteStore } from './sync';

export function createLocalRepoRemote(base = '/__repo'): RemoteStore {
  const headers = { 'X-Repo-Bridge': '1', 'Content-Type': 'application/json' };
  async function req<T>(p: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${p}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!res.ok) throw new Error(`local repository bridge ${p}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  return {
    info(): RemoteInfo {
      return { kind: 'local-repo', label: 'local repository (dev server)', private: true };
    },
    async verifyWritable() {
      await req('/health');
    },
    async snapshot(prefixes: string[]): Promise<RemoteSnapshot> {
      const r = await req<{ head: string; files: Array<[string, string]> }>('/snapshot', { prefixes });
      return { head: r.head, files: new Map(r.files) };
    },
    async read(path: string, sha: string): Promise<string> {
      const r = await req<{ content: string }>('/read', { path, sha });
      return r.content;
    },
    async commit(parentHead: string, changes: RemoteChange[], message: string): Promise<CommitResult> {
      return req<CommitResult>('/commit', { parentHead, changes, message });
    },
  };
}

export async function localBridgeAvailable(base = '/__repo'): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { headers: { 'X-Repo-Bridge': '1' }, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}
