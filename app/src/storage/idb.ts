// IndexedDB working copy. Holds records, sync bases, pending edits and conflicts.
// Never holds credentials: the GitHub token lives only in memory (see state/session.ts).
import type { LocalEntry, LocalStore } from '@core/sync';

const DB_NAME = 'self-ai-journey';
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    let result: T | undefined;
    if (r) r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
  });
}

export class IdbLocalStore implements LocalStore {
  private dbp: Promise<IDBDatabase> | null = null;
  private db() {
    return (this.dbp ??= open());
  }
  async get(path: string) {
    return (await tx<LocalEntry>(await this.db(), 'entries', 'readonly', (s) => s.get(path))) ?? undefined;
  }
  async put(e: LocalEntry) {
    await tx(await this.db(), 'entries', 'readwrite', (s) => void s.put(e));
  }
  async putMany(es: LocalEntry[]) {
    if (!es.length) return;
    await tx(await this.db(), 'entries', 'readwrite', (s) => {
      for (const e of es) s.put(e);
    });
  }
  async remove(path: string) {
    await tx(await this.db(), 'entries', 'readwrite', (s) => void s.delete(path));
  }
  async list() {
    return ((await tx<LocalEntry[]>(await this.db(), 'entries', 'readonly', (s) => s.getAll())) ?? []) as LocalEntry[];
  }
  async getMeta<T>(key: string) {
    return (await tx<T>(await this.db(), 'meta', 'readonly', (s) => s.get(key))) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await tx(await this.db(), 'meta', 'readwrite', (s) => void s.put(value, key));
  }
  /** Deletes every cached record, pending edit and setting on this device. */
  async destroy(): Promise<void> {
    if (this.dbp) (await this.dbp).close();
    this.dbp = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
}
