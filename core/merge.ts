// Semantic three-way merge for JSON records.
// - Plain objects merge field by field.
// - Arrays whose items all carry an `id` merge item by item (contacts, rounds, documents).
// - Other arrays and scalars are atomic values.
// - A field changed on both sides to different values is a conflict: neither side wins silently.
// - `updatedAt` never conflicts: the later timestamp wins.
import { clone, deepEqual } from './canonical';

export interface FieldConflict {
  path: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface MergeResult<T = unknown> {
  merged: T;
  conflicts: FieldConflict[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdArray = (v: unknown): v is Array<{ id: string }> =>
  Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');

const ALWAYS_LATEST = new Set(['updatedAt']);

export function threeWayMerge<T>(base: T | null | undefined, local: T, remote: T): MergeResult<T> {
  const conflicts: FieldConflict[] = [];
  const merged = mergeValue(base ?? undefined, local, remote, '', conflicts) as T;
  return { merged, conflicts };
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string, out: FieldConflict[]): unknown {
  if (deepEqual(local, remote)) return clone(local);
  if (deepEqual(base, local)) return clone(remote);
  if (deepEqual(base, remote)) return clone(local);
  const key = path.split('.').pop() ?? '';
  if (ALWAYS_LATEST.has(key) && typeof local === 'string' && typeof remote === 'string') {
    return local > remote ? local : remote;
  }
  if (isObj(local) && isObj(remote) && (base === undefined || isObj(base))) {
    const b = (base ?? {}) as Obj;
    const res: Obj = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)]);
    for (const k of keys) {
      const v = mergeValue(b[k], local[k], remote[k], path ? `${path}.${k}` : k, out);
      if (v !== undefined) res[k] = v;
    }
    return res;
  }
  if (isIdArray(local) && isIdArray(remote) && (base === undefined || isIdArray(base))) {
    const b = new Map(((base ?? []) as Array<{ id: string }>).map((x) => [x.id, x]));
    const l = new Map(local.map((x) => [x.id, x]));
    const r = new Map(remote.map((x) => [x.id, x]));
    const order = [...new Set([...remote.map((x) => x.id), ...local.map((x) => x.id)])];
    const res: unknown[] = [];
    for (const id of order) {
      const v = mergeValue(b.get(id), l.get(id), r.get(id), `${path}[id=${id}]`, out);
      if (v !== undefined) res.push(v);
    }
    return res;
  }
  out.push({ path: path || '(root)', base: clone(base), local: clone(local), remote: clone(remote) });
  return clone(local); // placeholder; callers must not persist a merge that has conflicts
}

/** Apply per-field choices to resolve conflicts. choice: 'local' | 'remote' | { value }. */
export function resolveConflicts<T>(
  merged: T,
  conflicts: FieldConflict[],
  choices: Record<string, 'local' | 'remote' | { value: unknown }>,
): T {
  const out = clone(merged) as unknown;
  for (const c of conflicts) {
    const choice = choices[c.path];
    if (!choice) throw new Error(`unresolved conflict at ${c.path}`);
    const value = choice === 'local' ? c.local : choice === 'remote' ? c.remote : choice.value;
    setAtPath(out, c.path, clone(value));
  }
  return out as T;
}

function setAtPath(root: unknown, path: string, value: unknown): void {
  if (path === '(root)') throw new Error('root-level conflict must be resolved by replacing the record');
  const parts = path.match(/[^.[\]]+|\[id=[^\]]+\]/g) ?? [];
  let cur = root as Obj | unknown[];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const last = i === parts.length - 1;
    if (p.startsWith('[id=')) {
      const idv = p.slice(4, -1);
      const arr = cur as Array<{ id: string }>;
      const idx = arr.findIndex((x) => x.id === idv);
      if (last) {
        if (value === undefined) { if (idx >= 0) arr.splice(idx, 1); }
        else if (idx >= 0) arr[idx] = value as { id: string };
        else arr.push(value as { id: string });
        return;
      }
      cur = arr[idx] as unknown as Obj;
    } else {
      const o = cur as Obj;
      if (last) {
        if (value === undefined) delete o[p];
        else o[p] = value;
        return;
      }
      if (o[p] === undefined) o[p] = {};
      cur = o[p] as Obj;
    }
  }
}
