// File System Access API adapter: point the app at a local clone of the private repository.
// Same contract as the GitHub adapter. createWritable() writes to a swap file that replaces the
// target only on close(), so each file write is atomic; the revision check guards concurrency.
import { gitBlobSha, sha1 } from '@core/sha1';
import { isBrowserWritable } from '@core/paths';
import type { CommitResult, RemoteChange, RemoteInfo, RemoteSnapshot, RemoteStore } from '@core/sync';

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

export function directoryAccessSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<DirHandle> }).showDirectoryPicker;
  return picker({ mode: 'readwrite', id: 'self-ai-journey-repo' });
}

async function walk(dir: DirHandle, prefix: string, out: Map<string, FileSystemFileHandle>) {
  for await (const h of dir.values()) {
    const rel = `${prefix}${h.name}`;
    if (h.kind === 'directory') await walk(h as DirHandle, `${rel}/`, out);
    else if (rel.endsWith('.json')) out.set(rel, h as FileSystemFileHandle);
  }
}

async function subdir(root: DirHandle, parts: string[], create: boolean): Promise<DirHandle> {
  let d = root;
  for (const p of parts) d = (await d.getDirectoryHandle(p, { create })) as DirHandle;
  return d;
}

export function createDirectoryRemote(root: DirHandle): RemoteStore {
  async function snap(prefixes: string[]): Promise<RemoteSnapshot> {
    const handles = new Map<string, FileSystemFileHandle>();
    let data: DirHandle;
    try {
      data = await subdir(root, ['data'], false);
    } catch {
      throw new Error('selected folder has no data/ directory; choose the root of your self-ai-journey clone');
    }
    await walk(data, 'data/', handles);
    const files = new Map<string, string>();
    for (const [p, h] of handles) if (prefixes.some((x) => p.startsWith(x))) files.set(p, gitBlobSha(await (await h.getFile()).text()));
    return { head: 'dir-' + sha1([...files].sort().map(([p, s]) => `${p} ${s}`).join('\n')).slice(0, 16), files };
  }
  return {
    info(): RemoteInfo {
      return { kind: 'directory', label: `folder:${root.name}`, private: true };
    },
    async verifyWritable() {
      const state = (await root.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      if (state !== 'granted' && (await root.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('write permission to the folder was not granted');
    },
    snapshot: snap,
    async read(path: string, sha: string) {
      const parts = path.split('/');
      const dir = await subdir(root, parts.slice(0, -1), false);
      const text = await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
      if (gitBlobSha(text) !== sha) throw new Error(`file changed since snapshot: ${path}`);
      return text;
    },
    async commit(parentHead: string, changes: RemoteChange[]): Promise<CommitResult> {
      const cur = await snap(['data/']);
      if (cur.head !== parentHead) return { ok: false, reason: 'stale' };
      for (const c of changes) {
        if (!isBrowserWritable(c.path) || c.content === null) throw new Error(`refusing to write ${c.path}`);
        const parts = c.path.split('/');
        const dir = await subdir(root, parts.slice(0, -1), true);
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(c.content);
        await w.close();
      }
      return { ok: true, head: (await snap(['data/'])).head };
    },
  };
}
