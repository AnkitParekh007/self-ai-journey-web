// GitHub REST adapter (Git Data API): atomic multi-file commits with optimistic concurrency.
// - The token lives only in this object's closure. It is never logged, persisted, or put in URLs.
// - Before any write the repository is fetched and must match owner/name AND be private.
// - Commits are created with parent = the head we merged against, then the branch ref is moved
//   with force=false. If anyone pushed in between, GitHub answers 422 → we report `stale`.
import type { CommitResult, RemoteChange, RemoteInfo, RemoteSnapshot, RemoteStore } from './sync';

export interface GitHubTarget {
  owner: string;
  repo: string;
  branch: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createGitHubRemote(target: GitHubTarget, token: string, fetchImpl: FetchLike = fetch.bind(globalThis)): RemoteStore & {
  disconnect(): void;
  isConnected(): boolean;
} {
  let secret: string | null = token;
  let verified: { private: boolean } | null = null;
  const api = 'https://api.github.com';
  const { owner, repo, branch } = target;
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error('invalid repository coordinates');
  }

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!secret) throw new GitHubError('not connected: token was cleared', 401);
    const res = await fetchImpl(`${api}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${secret}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) msg += ` ${String(body.message).slice(0, 200)}`;
      } catch {
        /* ignore */
      }
      throw new GitHubError(`GitHub API ${init.method ?? 'GET'} ${path.replace(/\?.*/, '')} failed: ${msg}`, res.status);
    }
    return (await res.json()) as T;
  }

  async function verify(): Promise<{ private: boolean }> {
    const r = await call<{ full_name: string; private: boolean; owner: { login: string }; name: string; permissions?: { push?: boolean } }>(
      `/repos/${owner}/${repo}`,
    );
    if (r.owner.login.toLowerCase() !== owner.toLowerCase() || r.name.toLowerCase() !== repo.toLowerCase()) {
      throw new Error(`token resolved to ${r.full_name}, expected ${owner}/${repo}`);
    }
    verified = { private: r.private };
    return verified;
  }

  return {
    info(): RemoteInfo {
      return { kind: 'github', label: `github:${owner}/${repo}@${branch}`, owner, repo, branch, private: verified?.private };
    },
    async verifyWritable() {
      const v = await verify();
      if (!v.private) throw new Error(`refusing to write: ${owner}/${repo} is not private`);
    },
    async snapshot(prefixes: string[]): Promise<RemoteSnapshot> {
      const ref = await call<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
      const commit = await call<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
      const tree = await call<{ tree: Array<{ path: string; type: string; sha: string }>; truncated: boolean }>(
        `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`,
      );
      if (tree.truncated) throw new Error('repository tree is too large for a single listing; sync a narrower prefix');
      const files = new Map<string, string>();
      for (const t of tree.tree) {
        if (t.type === 'blob' && t.path.endsWith('.json') && prefixes.some((p) => t.path.startsWith(p))) files.set(t.path, t.sha);
      }
      return { head: ref.object.sha, files };
    },
    async read(_path: string, sha: string): Promise<string> {
      const blob = await call<{ content: string; encoding: string }>(`/repos/${owner}/${repo}/git/blobs/${sha}`);
      if (blob.encoding !== 'base64') throw new Error(`unexpected blob encoding ${blob.encoding}`);
      return decodeBase64Utf8(blob.content);
    },
    async commit(parentHead: string, changes: RemoteChange[], message: string): Promise<CommitResult> {
      const parent = await call<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${parentHead}`);
      const tree = await call<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({
          base_tree: parent.tree.sha,
          tree: changes.map((c) => (c.content === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.content })),
        }),
      });
      const commit = await call<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [parentHead] }),
      });
      try {
        await call(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) return { ok: false, reason: 'stale', detail: 'branch moved; not a fast-forward' };
        throw e;
      }
      return { ok: true, head: commit.sha };
    },
    disconnect() {
      secret = null;
      verified = null;
    },
    isConnected() {
      return secret !== null;
    },
  };
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Basic shape check so obviously wrong input is rejected before any network call. */
export function looksLikeGitHubToken(t: string): boolean {
  return /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/.test(t.trim());
}
