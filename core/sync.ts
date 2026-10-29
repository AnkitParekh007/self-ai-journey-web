// Synchronization engine shared by the browser (IndexedDB ⇄ GitHub / local repo / folder)
// and tests. It never overwrites either side silently:
//   1. snapshot remote (head revision + blob SHA per file)
//   2. pull: clean local copies are refreshed; dirty ones are three-way merged against the
//      base they were edited from; same-field divergence becomes an explicit conflict
//   3. push: validated dirty records go out in ONE multi-file commit whose parent is the
//      snapshot head; if the remote moved meanwhile the commit is rejected (optimistic
//      concurrency) and the loop starts again from step 1
// Local edits stay `dirty` until a commit containing them succeeds, so an interrupted sync
// (offline, tab closed, 5xx) loses nothing.
import { deepEqual, toCanonicalJson } from './canonical';
import { threeWayMerge, type FieldConflict } from './merge';
import { gitBlobSha } from './sha1';
import { validateRecord } from './schemas';
import { isBrowserWritable } from './paths';

export interface LocalEntry {
  path: string;
  data: unknown;
  /** Blob SHA of the remote version this entry was last synchronized with; null = never synced. */
  baseSha: string | null;
  /** Remote content at baseSha, needed for three-way merges. */
  baseData: unknown | null;
  dirty: boolean;
  conflict: null | { remoteSha: string; remoteData: unknown; fields: FieldConflict[]; detectedAt: string; reason: 'edit' | 'deleted-remotely' };
  localUpdatedAt: string | null;
}

export interface LocalStore {
  get(path: string): Promise<LocalEntry | undefined>;
  put(entry: LocalEntry): Promise<void>;
  putMany(entries: LocalEntry[]): Promise<void>;
  remove(path: string): Promise<void>;
  list(): Promise<LocalEntry[]>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export interface RemoteInfo {
  kind: 'github' | 'local-repo' | 'directory' | 'memory';
  label: string;
  owner?: string;
  repo?: string;
  branch?: string;
  private?: boolean;
}

export interface RemoteSnapshot {
  head: string;
  files: Map<string, string>; // path -> blob sha
}

export interface RemoteChange {
  path: string;
  content: string | null; // null = delete (only used for conflict repair; records use tombstones)
}

export type CommitResult = { ok: true; head: string } | { ok: false; reason: 'stale' | 'rejected'; detail?: string };

export interface RemoteStore {
  info(): RemoteInfo;
  /** Throws if the target is not acceptable for writes (wrong repo, public repo, …). */
  verifyWritable(): Promise<void>;
  snapshot(prefixes: string[]): Promise<RemoteSnapshot>;
  read(path: string, sha: string): Promise<string>;
  commit(parentHead: string, changes: RemoteChange[], message: string): Promise<CommitResult>;
}

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'done' | 'error';

export interface SyncReport {
  pulled: number;
  merged: number;
  pushed: number;
  conflicts: string[];
  invalid: Array<{ path: string; error: string }>;
  attempts: number;
  head: string | null;
  error?: string;
}

export interface SyncOptions {
  prefixes?: string[];
  maxAttempts?: number;
  message?: string;
  now?: () => string;
  onPhase?: (phase: SyncPhase, detail?: string) => void;
  /** Only push paths matching this predicate (defaults to browser-writable paths). */
  canWrite?: (path: string) => boolean;
}

export function serialize(data: unknown): string {
  return toCanonicalJson(data);
}

export async function sync(local: LocalStore, remote: RemoteStore, opts: SyncOptions = {}): Promise<SyncReport> {
  const prefixes = opts.prefixes ?? ['data/'];
  const maxAttempts = opts.maxAttempts ?? 4;
  const now = opts.now ?? (() => new Date().toISOString());
  const canWrite = opts.canWrite ?? isBrowserWritable;
  const report: SyncReport = { pulled: 0, merged: 0, pushed: 0, conflicts: [], invalid: [], attempts: 0, head: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    report.attempts = attempt;
    opts.onPhase?.('pulling');
    const snap = await remote.snapshot(prefixes);
    await pull(local, remote, snap, report, now);

    const entries = await local.list();
    const toPush = entries.filter((e) => e.dirty && !e.conflict);
    if (toPush.length === 0) {
      report.head = snap.head;
      await local.setMeta('lastSync', { at: now(), head: snap.head, remote: remote.info().label });
      opts.onPhase?.('done');
      return report;
    }

    const changes: RemoteChange[] = [];
    const pushing: LocalEntry[] = [];
    for (const e of toPush) {
      if (!canWrite(e.path)) {
        report.invalid.push({ path: e.path, error: 'path is not writable from this client' });
        continue;
      }
      const v = validateRecord(e.data);
      if (!v.ok) {
        report.invalid.push({ path: e.path, error: v.error });
        continue;
      }
      changes.push({ path: e.path, content: serialize(e.data) });
      pushing.push(e);
    }
    if (changes.length === 0) {
      report.head = snap.head;
      opts.onPhase?.('done');
      return report;
    }

    opts.onPhase?.('pushing', `${changes.length} file(s)`);
    await remote.verifyWritable();
    const res = await remote.commit(snap.head, changes, opts.message ?? `sync: ${changes.length} record(s) from browser`);
    if (res.ok) {
      const updated = pushing.map((e, i) => ({
        ...e,
        baseSha: gitBlobSha(changes[i].content as string),
        baseData: e.data,
        dirty: false,
      }));
      // Entries edited again during the commit keep their newer data and stay dirty.
      const fresh = await Promise.all(updated.map((u) => local.get(u.path)));
      await local.putMany(
        updated.map((u, i) => {
          const cur = fresh[i];
          if (cur && !deepEqual(cur.data, pushing[i].data)) return { ...cur, baseSha: u.baseSha, baseData: u.baseData, dirty: true };
          return u;
        }),
      );
      report.pushed += changes.length;
      report.head = res.head;
      await local.setMeta('lastSync', { at: now(), head: res.head, remote: remote.info().label });
      opts.onPhase?.('done');
      return report;
    }
    if (res.reason !== 'stale') {
      report.error = `remote rejected commit: ${res.detail ?? res.reason}`;
      opts.onPhase?.('error', report.error);
      return report;
    }
    // stale: someone (a workflow, another device) committed first. Pull again and retry.
  }
  report.error = `remote kept changing; gave up after ${maxAttempts} attempts. Local edits are still pending.`;
  opts.onPhase?.('error', report.error);
  return report;
}

async function pull(local: LocalStore, remote: RemoteStore, snap: RemoteSnapshot, report: SyncReport, now: () => string): Promise<void> {
  const entries = new Map((await local.list()).map((e) => [e.path, e]));
  const writes: LocalEntry[] = [];
  for (const [path, sha] of snap.files) {
    const e = entries.get(path);
    if (e && e.baseSha === sha) continue;
    if (e?.conflict && e.conflict.remoteSha === sha) continue; // already known conflict
    const text = await remote.read(path, sha);
    let remoteData: unknown;
    try {
      remoteData = JSON.parse(text);
    } catch {
      report.invalid.push({ path, error: 'remote file is not valid JSON' });
      continue;
    }
    if (!e) {
      writes.push({ path, data: remoteData, baseSha: sha, baseData: remoteData, dirty: false, conflict: null, localUpdatedAt: null });
      report.pulled++;
      continue;
    }
    if (!e.dirty) {
      writes.push({ ...e, data: remoteData, baseSha: sha, baseData: remoteData, conflict: null });
      report.pulled++;
      continue;
    }
    // Local edits on top of an older base: merge.
    const { merged, conflicts } = threeWayMerge(e.baseData, e.data, remoteData);
    if (conflicts.length) {
      writes.push({ ...e, conflict: { remoteSha: sha, remoteData, fields: conflicts, detectedAt: now(), reason: 'edit' } });
      report.conflicts.push(path);
    } else {
      writes.push({ ...e, data: merged, baseSha: sha, baseData: remoteData, dirty: !deepEqual(merged, remoteData), conflict: null });
      report.merged++;
    }
  }
  // Files that disappeared remotely. Records use tombstones, so this is unusual: keep dirty
  // local copies as conflicts and drop clean ones.
  for (const [path, e] of entries) {
    if (snap.files.has(path) || e.baseSha === null) continue;
    if (e.dirty) {
      if (!e.conflict) {
        writes.push({ ...e, conflict: { remoteSha: '', remoteData: null, fields: [], detectedAt: now(), reason: 'deleted-remotely' } });
        report.conflicts.push(path);
      }
    } else {
      await local.remove(path);
    }
  }
  if (writes.length) await local.putMany(writes);
}

/** Record a local edit. Validation happens here so invalid data never enters the outbox. */
export async function writeLocal(local: LocalStore, path: string, data: unknown, now = new Date().toISOString()): Promise<LocalEntry> {
  const v = validateRecord(data);
  if (!v.ok) throw new Error(`refusing to save invalid record ${path}: ${v.error}`);
  const prev = await local.get(path);
  const entry: LocalEntry = {
    path,
    data: v.value,
    baseSha: prev?.baseSha ?? null,
    baseData: prev?.baseData ?? null,
    dirty: true,
    conflict: prev?.conflict ?? null,
    localUpdatedAt: now,
  };
  await local.put(entry);
  return entry;
}

/** Resolve a conflict with fully-specified data; the result is rebased onto the remote version. */
export async function resolveEntry(local: LocalStore, path: string, resolved: unknown): Promise<void> {
  const e = await local.get(path);
  if (!e?.conflict) throw new Error(`no conflict at ${path}`);
  const v = validateRecord(resolved);
  if (!v.ok) throw new Error(`resolution is invalid: ${v.error}`);
  const { remoteSha, remoteData, reason } = e.conflict;
  await local.put({
    ...e,
    data: v.value,
    baseSha: reason === 'deleted-remotely' ? null : remoteSha,
    baseData: reason === 'deleted-remotely' ? null : remoteData,
    dirty: true,
    conflict: null,
    localUpdatedAt: new Date().toISOString(),
  });
}

export type RecordSyncState = 'local' | 'synced' | 'pending' | 'conflict';

export function entryState(e: LocalEntry): RecordSyncState {
  if (e.conflict) return 'conflict';
  if (e.dirty) return e.baseSha === null ? 'local' : 'pending';
  return 'synced';
}

// ---------- in-memory implementations (tests, CLI dry runs) ----------

export class MemoryLocalStore implements LocalStore {
  entries = new Map<string, LocalEntry>();
  meta = new Map<string, unknown>();
  async get(path: string) {
    const e = this.entries.get(path);
    return e ? structuredClone(e) : undefined;
  }
  async put(e: LocalEntry) {
    this.entries.set(e.path, structuredClone(e));
  }
  async putMany(es: LocalEntry[]) {
    for (const e of es) this.entries.set(e.path, structuredClone(e));
  }
  async remove(path: string) {
    this.entries.delete(path);
  }
  async list() {
    return [...this.entries.values()].map((e) => structuredClone(e));
  }
  async getMeta<T>(k: string) {
    return this.meta.get(k) as T | undefined;
  }
  async setMeta(k: string, v: unknown) {
    this.meta.set(k, v);
  }
}

/** A Git-like remote kept in memory: commits are atomic and require the current head as parent. */
export class MemoryRemoteStore implements RemoteStore {
  files = new Map<string, string>();
  head = 'rev-0';
  private rev = 0;
  commits: Array<{ head: string; paths: string[]; message: string }> = [];
  /** Test hooks. */
  failNextCommit: null | Error = null;
  beforeCommit: null | (() => void) = null;
  isPrivate = true;

  info(): RemoteInfo {
    return { kind: 'memory', label: 'memory', private: this.isPrivate };
  }
  async verifyWritable() {
    if (!this.isPrivate) throw new Error('refusing to write: repository is not private');
  }
  async snapshot(prefixes: string[]): Promise<RemoteSnapshot> {
    const files = new Map<string, string>();
    for (const [p, c] of this.files) if (prefixes.some((x) => p.startsWith(x))) files.set(p, gitBlobSha(c));
    return { head: this.head, files };
  }
  async read(path: string, sha: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined || gitBlobSha(c) !== sha) throw new Error(`blob ${sha} not found for ${path}`);
    return c;
  }
  async commit(parent: string, changes: RemoteChange[], message: string): Promise<CommitResult> {
    this.beforeCommit?.();
    if (this.failNextCommit) {
      const err = this.failNextCommit;
      this.failNextCommit = null;
      throw err;
    }
    if (parent !== this.head) return { ok: false, reason: 'stale' };
    for (const c of changes) {
      if (c.content === null) this.files.delete(c.path);
      else this.files.set(c.path, c.content);
    }
    this.head = `rev-${++this.rev}`;
    this.commits.push({ head: this.head, paths: changes.map((c) => c.path), message });
    return { ok: true, head: this.head };
  }
  /** Simulate another writer (e.g. a GitHub Actions commit). */
  externalWrite(path: string, data: unknown) {
    this.files.set(path, serialize(data));
    this.head = `rev-${++this.rev}`;
  }
}
