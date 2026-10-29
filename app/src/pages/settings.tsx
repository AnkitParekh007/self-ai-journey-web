import { useEffect, useState } from 'react';
import type { FieldConflict } from '@core/merge';
import { resolveConflicts, threeWayMerge } from '@core/merge';
import { localBridgeAvailable } from '@core/remote-http';
import { toCanonicalJson } from '@core/canonical';
import { Badge, Card, Field, Modal, PageHead, downloadBlob, downloadText, useStore, useToast } from '../ui/components';
import { connectDirectory, connectGitHub, connectLocalRepo, disconnect, githubConnected } from '../state/session';
import { directoryAccessSupported } from '../storage/remote-directory';
import { IdbLocalStore } from '../storage/idb';
import { ago } from '../lib/dates';
import { loadDemoData } from '../state/demo';
import type { ImportReport } from '../state/store';

const INDICATOR: Record<string, { label: string; dot: string; help: string }> = {
  'local-only': { label: 'Local only', dot: 'dot-info', help: 'Saved in this browser. Not connected to a repository.' },
  synced: { label: 'Synced', dot: 'dot-ok', help: 'All edits are in the connected repository.' },
  pending: { label: 'Pending', dot: 'dot-warn', help: 'Edits are saved locally and waiting for the next sync.' },
  syncing: { label: 'Syncing…', dot: 'dot-info', help: 'Synchronizing with the repository.' },
  conflict: { label: 'Conflict', dot: 'dot-bad', help: 'Some records changed in two places. Resolve them in Data & sync.' },
  error: { label: 'Sync error', dot: 'dot-bad', help: 'The last sync failed. Local edits are kept.' },
};

export function SyncPill() {
  const store = useStore();
  const s = store.status();
  const ind = INDICATOR[s.indicator];
  return (
    <a className="pill" href="#/settings" title={ind.help} aria-label={`Sync status: ${ind.label}. ${ind.help}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className={`dot ${ind.dot}`} aria-hidden="true" />
      {ind.label}
      {s.pending > 0 && <span className="muted small">· {s.pending} pending</span>}
    </a>
  );
}

export function SettingsPage() {
  const store = useStore();
  const toast = useToast();
  const s = store.status();
  const [bridge, setBridge] = useState(false);
  const [owner, setOwner] = useState(__PUBLIC_SHELL__ ? '' : 'AnkitParekh007');
  const [repo, setRepo] = useState(__PUBLIC_SHELL__ ? '' : 'ai-self-journey');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importRep, setImportRep] = useState<ImportReport | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const gh = githubConnected();

  useEffect(() => {
    if (!__PUBLIC_SHELL__) localBridgeAvailable().then(setBridge);
    store.local.getMeta<{ owner: string; repo: string; branch: string }>('githubTarget').then((t) => {
      if (t) {
        setOwner(t.owner);
        setRepo(t.repo);
        setBranch(t.branch);
      }
    });
  }, [store]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message.replace(/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[redacted]'));
    } finally {
      setBusy(false);
    }
  };

  const automation = store.allEntries().find((e) => e.path === 'data/discovery/automation-status.json')?.data as Record<string, string | number | null> | undefined;

  return (
    <>
      <PageHead title="Data & sync" sub="Browser → IndexedDB working copy → explicit sync → your private GitHub repository." />
      <div className="grid grid-2">
        <Card title="Status" sub={INDICATOR[s.indicator].help}>
          <dl className="grid grid-2 small" style={{ margin: 0 }}>
            <div><dt className="muted">Connection</dt><dd style={{ margin: 0 }}>{s.remoteLabel ?? 'none (local only)'}</dd></div>
            <div><dt className="muted">Last sync</dt><dd style={{ margin: 0 }}>{ago(s.lastSyncAt)}</dd></div>
            <div><dt className="muted">Pending edits</dt><dd style={{ margin: 0 }}>{s.pending}</dd></div>
            <div><dt className="muted">Conflicts</dt><dd style={{ margin: 0 }}>{s.conflicts}</dd></div>
            <div><dt className="muted">Records on this device</dt><dd style={{ margin: 0 }}>{store.allEntries().length}</dd></div>
            <div><dt className="muted">Discovery automation</dt><dd style={{ margin: 0 }}>{automation ? `${automation.lastOutcome} · attempted ${ago(String(automation.lastAttemptAt))} · last success ${ago(automation.lastSuccessAt as string | null)}` : 'no run synced yet'}</dd></div>
          </dl>
          {s.error && <div className="callout callout-bad small" style={{ marginTop: '0.75rem' }}>{s.error}</div>}
          {s.lastReport && (
            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              Last sync: pulled {s.lastReport.pulled}, merged {s.lastReport.merged}, pushed {s.lastReport.pushed}, conflicts {s.lastReport.conflicts.length}, attempts {s.lastReport.attempts}
              {s.lastReport.invalid.length > 0 && `, ${s.lastReport.invalid.length} invalid record(s) not pushed`}.
            </p>
          )}
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-primary" disabled={!store.hasRemote() || busy} onClick={() => run(async () => { const r = await store.syncNow(); if (r) toast(r.error ? 'Sync stopped; edits kept locally' : `Synced: ${r.pushed} pushed, ${r.pulled + r.merged} pulled`); })}>
              Sync now
            </button>
            {store.hasRemote() && <button className="btn" onClick={() => { disconnect(store); toast('Disconnected. The token was forgotten; cached records remain on this device.'); }}>Disconnect</button>}
          </div>
        </Card>

        <Card title="Connect your private repository" sub="Choose one. Nothing is sent anywhere until you press Sync now.">
          {err && <div className="callout callout-bad small" role="alert">{err}</div>}
          {!__PUBLIC_SHELL__ && (
            <div className="stack" style={{ marginBottom: '1rem' }}>
              <strong>A. Local repository (recommended on your laptop)</strong>
              <span className="small muted">Uses the files of the clone you started <code>npm run dev</code> in. Atomic file writes with revision checks. No token.</span>
              <div><button className="btn" disabled={!bridge || busy} onClick={() => { connectLocalRepo(store); toast('Connected to local repository'); }}>{bridge ? 'Use local repository' : 'Not available (start npm run dev)'}</button></div>
            </div>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await connectGitHub(store, { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() }, token);
                setToken('');
                toast('Connected to GitHub. Token is held in memory only.');
              });
            }}
          >
            <strong>B. GitHub (any device)</strong>
            <span className="small muted">
              Create a <em>fine-grained</em> personal access token with access to <strong>only this repository</strong> and permissions <code>Contents: Read and write</code> (Metadata: read is added automatically). The repository must be private or writes are refused. The token stays in memory and is forgotten on reload.
            </span>
            <div className="grid grid-3">
              <Field label="Owner"><input value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
              <Field label="Repository"><input value={repo} onChange={(e) => setRepo(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
              <Field label="Branch"><input value={branch} onChange={(e) => setBranch(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
            </div>
            <Field label="Fine-grained token" hint="Never stored in localStorage, IndexedDB, exports, URLs or logs.">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} name="gh-token-memory-only" />
            </Field>
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={busy || !token}>Verify &amp; connect</button>
              {gh && <Badge tone="ok">connected to {gh.owner}/{gh.repo}@{gh.branch}</Badge>}
            </div>
          </form>
          <div className="stack" style={{ marginTop: '1rem' }}>
            <strong>C. Folder on this computer</strong>
            <span className="small muted">Pick your local clone with the File System Access API (Chromium browsers). Elsewhere, use export/import below.</span>
            <div><button className="btn" disabled={!directoryAccessSupported() || busy} onClick={() => run(async () => { await connectDirectory(store); toast('Folder connected'); })}>{directoryAccessSupported() ? 'Choose folder…' : 'Not supported in this browser'}</button></div>
          </div>
        </Card>
      </div>

      <ConflictsCard />

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Import & export" sub="Round-trips every record and its sync state. Exports never contain credentials.">
          <div className="row">
            <button className="btn" onClick={() => downloadText(`self-ai-journey-${new Date().toISOString().slice(0, 10)}.json`, store.exportSnapshot())}>Export JSON</button>
            <button
              className="btn"
              onClick={async () => {
                const { default: JSZip } = await import('jszip');
                const zip = new JSZip();
                for (const e of store.allEntries()) zip.file(e.path, toCanonicalJson(e.data));
                zip.file('EXPORT-README.txt', 'Repository-shaped export of data/ from Self AI Journey. Copy into your private repository and commit, or import back into the app.\n');
                downloadBlob(`self-ai-journey-data-${new Date().toISOString().slice(0, 10)}.zip`, await zip.generateAsync({ type: 'blob' }));
              }}
            >
              Export ZIP (repo layout)
            </button>
            <label className="btn">
              Import JSON/ZIP…
              <input
                type="file"
                accept=".json,.zip,application/json,application/zip"
                className="sr-only"
                onChange={(e) =>
                  run(async () => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (f.name.endsWith('.zip')) {
                      const { default: JSZip } = await import('jszip');
                      const zip = await JSZip.loadAsync(f);
                      const items: Array<{ path: string; data: unknown }> = [];
                      for (const [p, file] of Object.entries(zip.files)) {
                        if (file.dir || !p.startsWith('data/') || !p.endsWith('.json')) continue;
                        try {
                          items.push({ path: p, data: JSON.parse(await file.async('string')) });
                        } catch {
                          /* reported as invalid below */
                          items.push({ path: p, data: null });
                        }
                      }
                      setImportRep(await store.importEntries(items));
                    } else setImportRep(await store.importText(await f.text()));
                  })
                }
              />
            </label>
          </div>
          {importRep && (
            <div className="callout small" style={{ marginTop: '0.75rem' }} role="status">
              Import: {importRep.added} added, {importRep.updated} merged, {importRep.unchanged} unchanged, {importRep.conflicts.length} skipped as conflicting, {importRep.invalid.length} invalid.
              {importRep.invalid.slice(0, 5).map((i) => (
                <div key={i.path} className="mono tiny">{i.path}: {i.error}</div>
              ))}
            </div>
          )}
          {store.allEntries().length === 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button className="btn btn-sm" onClick={() => run(async () => { await loadDemoData(store); toast('Loaded synthetic demo data'); })}>Load synthetic demo data</button>
              <p className="tiny muted">Fictional companies and jobs, clearly labeled, for trying the app. Delete with “Clear local data”.</p>
            </div>
          )}
        </Card>

        <Card title="Privacy on this device" sub="Local browser data is sensitive: anyone with access to this browser profile can read it.">
          <ul className="small">
            <li><strong>Disconnect</strong> forgets the GitHub token or folder handle. Cached records stay here so you can keep working offline.</li>
            <li><strong>Clear local data</strong> deletes every cached record, pending edit and setting in this browser. Unsynced edits are lost unless exported first.</li>
            <li>No analytics, no third-party requests. The only network destination is api.github.com when you sync.</li>
          </ul>
          <button className="btn btn-danger" onClick={() => setConfirmClear(true)}>Clear local data…</button>
          <Modal
            open={confirmClear}
            title="Delete all data in this browser?"
            onClose={() => setConfirmClear(false)}
            footer={
              <>
                <button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
                <button
                  className="btn btn-danger"
                  onClick={() =>
                    run(async () => {
                      disconnect(store);
                      await store.clearLocalData(() => (store.local as IdbLocalStore).destroy?.() ?? Promise.resolve());
                      setConfirmClear(false);
                      toast('Local data cleared');
                    })
                  }
                >
                  Delete local data
                </button>
              </>
            }
          >
            <p>
              This removes {store.allEntries().length} record(s) from this browser, including <strong>{s.pending}</strong> unsynced edit(s). Your repository is not touched.
            </p>
            {s.pending > 0 && <div className="callout callout-warn small">Export first if you want to keep the unsynced edits.</div>}
          </Modal>
        </Card>
      </div>
    </>
  );
}

function ConflictsCard() {
  const store = useStore();
  const toast = useToast();
  const conflicts = store.conflicts();
  const [choices, setChoices] = useState<Record<string, Record<string, 'local' | 'remote'>>>({});
  if (!conflicts.length) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <Card title={<>Conflicts <Badge tone="bad">{conflicts.length}</Badge></>} sub="The same field changed on this device and in the repository. Nothing was overwritten. Choose which value to keep per field.">
        <div className="stack">
          {conflicts.map((e) => {
            const c = e.conflict!;
            const fields: FieldConflict[] = c.fields;
            const pick = choices[e.path] ?? {};
            return (
              <details key={e.path} open>
                <summary className="mono small">{e.path} {c.reason === 'deleted-remotely' && <Badge tone="warn">deleted in repository</Badge>}</summary>
                {c.reason === 'deleted-remotely' ? (
                  <div className="row" style={{ marginTop: '0.5rem' }}>
                    <button className="btn btn-sm" onClick={async () => { await store.resolve(e.path, e.data); toast('Kept local copy; it will be re-created on sync'); }}>Keep my copy</button>
                  </div>
                ) : (
                  <>
                    <table className="table" style={{ marginTop: '0.5rem' }}>
                      <thead><tr><th>Field</th><th>This device</th><th>Repository</th></tr></thead>
                      <tbody>
                        {fields.map((f) => (
                          <tr key={f.path}>
                            <td className="mono tiny">{f.path}</td>
                            {(['local', 'remote'] as const).map((side) => (
                              <td key={side}>
                                <label className="row small" style={{ alignItems: 'flex-start' }}>
                                  <input type="radio" name={`${e.path}:${f.path}`} checked={pick[f.path] === side} onChange={() => setChoices({ ...choices, [e.path]: { ...pick, [f.path]: side } })} />
                                  <span className="mono tiny wrap-anywhere">{JSON.stringify(side === 'local' ? f.local : f.remote)?.slice(0, 400) ?? '(empty)'}</span>
                                </label>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={fields.some((f) => !pick[f.path])}
                      onClick={async () => {
                        // Re-run the three-way merge (keeps every non-conflicting change from both sides),
                        // then apply the per-field choices.
                        const { merged } = threeWayMerge(e.baseData, e.data, c.remoteData);
                        const resolved = resolveConflicts(merged, fields, pick);
                        await store.resolve(e.path, resolved);
                        toast('Resolved. Sync to publish the result.');
                      }}
                    >
                      Apply choices
                    </button>
                  </>
                )}
              </details>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
