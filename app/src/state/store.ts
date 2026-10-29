// Application state over the IndexedDB working copy.
// Data flow: UI → store.save() (validated) → IndexedDB entry marked dirty → explicit sync()
// → remote (GitHub / local repo / folder). Remote changes come back through the same sync().
import { deepEqual, toCanonicalJson } from '@core/canonical';
import { threeWayMerge } from '@core/merge';
import { recordPath, isEventBatchPath } from '@core/paths';
import { newId } from '@core/ids';
import { SCHEMA_VERSION, validateRecord, type AppEvent, type EventBatch, type RecordKind } from '@core/schemas';
import { entryState, sync, writeLocal, resolveEntry, type LocalEntry, type LocalStore, type RemoteStore, type SyncReport } from '@core/sync';

export type SyncIndicator = 'local-only' | 'synced' | 'pending' | 'syncing' | 'conflict' | 'error';

export interface SyncStatus {
  indicator: SyncIndicator;
  remoteLabel: string | null;
  lastSyncAt: string | null;
  lastReport: SyncReport | null;
  error: string | null;
  pending: number;
  conflicts: number;
}

type Listener = () => void;

export interface ImportReport {
  added: number;
  updated: number;
  unchanged: number;
  conflicts: string[];
  invalid: Array<{ path: string; error: string }>;
}

export class AppStore {
  private entries = new Map<string, LocalEntry>();
  private listeners = new Set<Listener>();
  private remote: RemoteStore | null = null;
  private syncing = false;
  private lastError: string | null = null;
  private lastReport: SyncReport | null = null;
  private lastSyncAt: string | null = null;
  version = 0;
  ready = false;

  constructor(public local: LocalStore) {}

  async init(): Promise<void> {
    await this.reload();
    const last = await this.local.getMeta<{ at: string }>('lastSync');
    this.lastSyncAt = last?.at ?? null;
    this.ready = true;
    this.emit();
  }

  private async reload() {
    this.entries = new Map((await this.local.list()).map((e) => [e.path, e]));
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ----- reads -----

  records<T = unknown>(kind: RecordKind, opts: { includeDeleted?: boolean } = {}): T[] {
    const out: T[] = [];
    for (const e of this.entries.values()) {
      const d = e.data as { kind?: string; deletedAt?: string | null };
      if (d?.kind === kind && (opts.includeDeleted || !d.deletedAt)) out.push(e.data as T);
    }
    return out;
  }

  record<T = unknown>(kind: RecordKind, id: string): T | undefined {
    const e = this.entries.get(recordPath(kind, id));
    const d = e?.data as { deletedAt?: string | null } | undefined;
    return d && !d.deletedAt ? (e!.data as T) : undefined;
  }

  entryFor(kind: RecordKind, id: string): LocalEntry | undefined {
    return this.entries.get(recordPath(kind, id));
  }

  events(): AppEvent[] {
    const out: AppEvent[] = [];
    const seen = new Set<string>();
    for (const e of this.entries.values()) {
      if (!isEventBatchPath(e.path)) continue;
      for (const ev of (e.data as EventBatch).events ?? []) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          out.push(ev);
        }
      }
    }
    return out.sort((a, b) => (a.at + a.recordedAt).localeCompare(b.at + b.recordedAt));
  }

  allEntries(): LocalEntry[] {
    return [...this.entries.values()];
  }

  conflicts(): LocalEntry[] {
    return [...this.entries.values()].filter((e) => e.conflict);
  }

  status(): SyncStatus {
    let pending = 0;
    let conflicts = 0;
    for (const e of this.entries.values()) {
      const s = entryState(e);
      if (s === 'pending' || s === 'local') pending++;
      if (s === 'conflict') conflicts++;
    }
    let indicator: SyncIndicator;
    if (this.syncing) indicator = 'syncing';
    else if (conflicts) indicator = 'conflict';
    else if (this.lastError) indicator = 'error';
    else if (!this.remote) indicator = 'local-only';
    else if (pending) indicator = 'pending';
    else indicator = 'synced';
    return { indicator, remoteLabel: this.remote?.info().label ?? null, lastSyncAt: this.lastSyncAt, lastReport: this.lastReport, error: this.lastError, pending, conflicts };
  }

  // ----- writes -----

  async save<T extends { kind: string; id: string; updatedAt?: string }>(record: T): Promise<T> {
    const now = new Date().toISOString();
    const data = { ...record, updatedAt: now } as T;
    const path = recordPath(record.kind as RecordKind, record.id);
    const e = await writeLocal(this.local, path, data, now);
    this.entries.set(path, e);
    this.emit();
    return e.data as T;
  }

  /** Save several records and their events together; they sync in the same commit. */
  async saveWithEvents<T extends { kind: string; id: string }>(records: T[], events: AppEvent[]): Promise<void> {
    for (const r of records) await this.save(r);
    if (events.length) await this.appendEvents(events);
  }

  /** Soft delete: a tombstone keeps the record from reappearing after the next sync. */
  async remove(kind: RecordKind, id: string): Promise<void> {
    const cur = this.entries.get(recordPath(kind, id))?.data as Record<string, unknown> | undefined;
    if (!cur) return;
    const now = new Date().toISOString();
    await this.save({ ...(cur as { kind: string; id: string }), deletedAt: now });
    await this.appendEvents([
      { id: newId('evt'), type: 'deleted', at: now, recordedAt: now, subject: { kind, id }, actor: 'user', confirmation: 'not_applicable', data: {}, provenance: [] },
    ]);
  }

  /**
   * Events accumulate in one open batch file until it has been synced once; after that the
   * file is immutable and a new batch is started.
   */
  async appendEvents(events: AppEvent[]): Promise<void> {
    if (!events.length) return;
    const now = new Date().toISOString();
    const openPath = await this.local.getMeta<string>('openBatchPath');
    const open = openPath ? this.entries.get(openPath) : undefined;
    let batch: EventBatch;
    let path: string;
    if (open && open.baseSha === null && !open.conflict) {
      batch = { ...(open.data as EventBatch), events: [...(open.data as EventBatch).events, ...events] };
      path = open.path;
    } else {
      batch = { schemaVersion: SCHEMA_VERSION, kind: 'event-batch', id: newId('batch'), createdAt: now, events };
      path = recordPath('event-batch', batch.id, now);
      await this.local.setMeta('openBatchPath', path);
    }
    const e = await writeLocal(this.local, path, batch, now);
    this.entries.set(path, e);
    this.emit();
  }

  // ----- remote -----

  setRemote(remote: RemoteStore | null) {
    this.remote = remote;
    this.lastError = null;
    this.emit();
  }

  hasRemote() {
    return !!this.remote;
  }

  async syncNow(): Promise<SyncReport | null> {
    if (!this.remote || this.syncing) return null;
    this.syncing = true;
    this.lastError = null;
    this.emit();
    try {
      const report = await sync(this.local, this.remote);
      this.lastReport = report;
      if (report.error) this.lastError = report.error;
      else this.lastSyncAt = new Date().toISOString();
      return report;
    } catch (e) {
      this.lastError = sanitizeError((e as Error).message);
      return null;
    } finally {
      this.syncing = false;
      await this.reload();
      this.emit();
    }
  }

  async resolve(path: string, resolved: unknown) {
    await resolveEntry(this.local, path, resolved);
    await this.reload();
    this.emit();
  }

  // ----- import / export -----

  exportSnapshot(): string {
    const entries = [...this.entries.values()].map((e) => ({ path: e.path, data: e.data, baseSha: e.baseSha, baseData: e.baseData, dirty: e.dirty }));
    return toCanonicalJson({ format: 'self-ai-journey-export', version: 1, exportedAt: new Date().toISOString(), entries });
  }

  async importEntries(items: Array<{ path: string; data: unknown; baseSha?: string | null; baseData?: unknown; dirty?: boolean }>): Promise<ImportReport> {
    const rep: ImportReport = { added: 0, updated: 0, unchanged: 0, conflicts: [], invalid: [] };
    const writes: LocalEntry[] = [];
    for (const it of items) {
      if (typeof it.path !== 'string' || !it.path.startsWith('data/') || it.path.includes('..')) {
        rep.invalid.push({ path: String(it.path), error: 'path outside data/' });
        continue;
      }
      const v = validateRecord(it.data);
      if (!v.ok) {
        rep.invalid.push({ path: it.path, error: v.error });
        continue;
      }
      const cur = this.entries.get(it.path);
      if (!cur) {
        writes.push({ path: it.path, data: v.value, baseSha: it.baseSha ?? null, baseData: it.baseData ?? null, dirty: it.baseSha ? !!it.dirty : true, conflict: null, localUpdatedAt: new Date().toISOString() });
        rep.added++;
        continue;
      }
      if (deepEqual(cur.data, v.value)) {
        rep.unchanged++;
        continue;
      }
      const { merged, conflicts } = threeWayMerge(cur.baseData, cur.data, v.value);
      if (conflicts.length) {
        rep.conflicts.push(it.path);
        continue;
      }
      writes.push({ ...cur, data: merged, dirty: true, localUpdatedAt: new Date().toISOString() });
      rep.updated++;
    }
    await this.local.putMany(writes);
    await this.reload();
    this.emit();
    return rep;
  }

  async importText(text: string): Promise<ImportReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('file is not valid JSON');
    }
    const p = parsed as { format?: string; entries?: unknown[] };
    if (p.format === 'self-ai-journey-export' && Array.isArray(p.entries)) return this.importEntries(p.entries as never);
    // A single record or an array of records.
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return this.importEntries(
      list.map((r) => {
        const rec = r as { kind: RecordKind; id: string; createdAt?: string };
        let path = '';
        try {
          path = recordPath(rec.kind, rec.id, rec.createdAt);
        } catch {
          path = `invalid/${String(rec?.id)}`;
        }
        return { path, data: r };
      }),
    );
  }

  async clearLocalData(destroy: () => Promise<void>) {
    this.remote = null;
    await destroy();
    this.entries.clear();
    this.lastReport = null;
    this.lastSyncAt = null;
    this.lastError = null;
    this.emit();
  }
}

/** Strip anything token-shaped from messages before they reach the UI or logs. */
export function sanitizeError(msg: string): string {
  return msg.replace(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)/g, '[redacted]').replace(/Bearer\s+\S+/g, 'Bearer [redacted]');
}
