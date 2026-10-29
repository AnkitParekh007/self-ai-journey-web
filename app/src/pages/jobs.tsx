import { useEffect, useMemo, useState } from 'react';
import { SCHEMA_VERSION, type Application, type Job } from '@core/schemas';
import { newId } from '@core/ids';
import { sha1 } from '@core/sha1';
import { Badge, Card, Empty, Field, PageHead, eligLabel, eligTone, useRecords, useStore, useToast } from '../ui/components';
import { href, navigate } from '../lib/router';
import { ago, todayIso } from '../lib/dates';
import { automationStatus, discoveryRuns, scheduleHealth, sourceHealth } from '../state/selectors';

interface Filters {
  q: string;
  country: string;
  cls: string;
  visa: string;
  india: string;
  salary: string;
  fresh: string;
  triage: string;
  closed: boolean;
  sort: 'score' | 'posted' | 'firstSeen' | 'company';
}
const DEFAULT: Filters = { q: '', country: '', cls: 'active', visa: '', india: '', salary: '', fresh: '', triage: 'active', closed: false, sort: 'score' };

export function nextAppId(apps: Application[]): string {
  const max = apps.reduce((m, a) => Math.max(m, Number(a.id.match(/^APP-(\d+)$/)?.[1] ?? 0)), 0);
  return `APP-${String(max + 1).padStart(3, '0')}`;
}

export function JobsPage({ id }: { id?: string; query: URLSearchParams }) {
  if (id) return <JobDetail id={id} />;
  return <JobList />;
}

function JobList() {
  const store = useStore();
  const jobs = useRecords<Job>('job');
  const [f, setF] = useState<Filters>(DEFAULT);
  const [views, setViews] = useState<Record<string, Filters>>({});
  const [showHealth, setShowHealth] = useState(false);
  useEffect(() => {
    store.local.getMeta<Record<string, Filters>>('savedJobViews').then((v) => v && setViews(v));
  }, [store]);
  const set = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }));
  const countries = useMemo(() => [...new Set(jobs.flatMap((j) => (j.countries.length ? j.countries : [j.countryPriority === 6 ? 'Remote (India)' : 'Other'])))].sort(), [jobs]);
  const today = todayIso();
  const list = useMemo(() => {
    const q = f.q.toLowerCase();
    return jobs
      .filter((j) => {
        if (q && !`${j.title} ${j.company} ${j.location} ${j.matchedSkills.join(' ')}`.toLowerCase().includes(q)) return false;
        const cs = j.countries.length ? j.countries : [j.countryPriority === 6 ? 'Remote (India)' : 'Other'];
        if (f.country && !cs.includes(f.country)) return false;
        if (f.cls === 'active' ? !['qualified', 'stretch'].includes(j.classification) : f.cls && j.classification !== f.cls) return false;
        if (f.visa && j.eligibility.sponsorship.status !== f.visa) return false;
        if (f.india && j.eligibility.indiaRemote.status !== f.india) return false;
        if (f.salary === 'stated' && j.salary.status !== 'stated') return false;
        if (f.fresh) {
          const ref = (j.postedAt ?? j.firstSeenAt).slice(0, 10);
          if ((Date.parse(today) - Date.parse(ref)) / 864e5 > Number(f.fresh)) return false;
        }
        if (f.triage === 'active' && ['dismissed', 'promoted'].includes(j.triage.state)) return false;
        if (f.triage && f.triage !== 'active' && j.triage.state !== f.triage) return false;
        if (!f.closed && j.openness.status === 'closed') return false;
        return true;
      })
      .sort((a, b) => {
        if (f.sort === 'posted') return (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
        if (f.sort === 'firstSeen') return b.firstSeenAt.localeCompare(a.firstSeenAt);
        if (f.sort === 'company') return a.company.localeCompare(b.company);
        return (b.score?.total ?? -1) - (a.score?.total ?? -1);
      });
  }, [jobs, f, today]);

  const st = automationStatus(store);
  const sh = scheduleHealth(st);
  const runs = discoveryRuns(store);
  const health = sourceHealth(store);

  return (
    <>
      <PageHead
        title="Job discovery"
        sub={`${list.length} of ${jobs.length} jobs. Scores are heuristic relevance (0–100), not ATS scores or hiring probabilities.`}
        actions={<button className="btn" aria-expanded={showHealth} onClick={() => setShowHealth((s) => !s)}>Source health</button>}
      />
      <div className={`callout small ${sh.state === 'ok' ? 'callout-ok' : sh.state === 'never' ? '' : 'callout-warn'}`}>
        <strong>Discovery:</strong> {sh.text} Last attempt {ago(st?.lastAttemptAt)} ({st?.lastAttemptTrigger ?? '–'}), last full success {ago(st?.lastSuccessAt)}.
        {runs[0] && <> Latest run: {runs[0].counts.newQualified ?? 0} new qualified of target {runs[0].target.min}–{runs[0].target.max}; shortfall {runs[0].shortfall}; {runs[0].counts.sourcesOk}/{runs[0].counts.sources} sources ok.</>}
      </div>
      {showHealth && (
        <Card title="Sources" sub="A failed fetch means jobs from that source are unknown today, not closed.">
          {health ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Source</th><th>Last success</th><th>Last attempt</th><th>Failures</th><th>Last count</th><th>Error</th></tr></thead>
                <tbody>
                  {Object.entries(health.sources).sort((a, b) => b[1].consecutiveFailures - a[1].consecutiveFailures).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono tiny">{k}</td>
                      <td>{ago(v.lastSuccessAt)}</td>
                      <td>{ago(v.lastAttemptAt)}</td>
                      <td>{v.consecutiveFailures ? <Badge tone="bad">{v.consecutiveFailures}</Badge> : 0}</td>
                      <td>{v.lastCount}</td>
                      <td className="tiny wrap-anywhere">{v.lastError ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No source health yet">Run discovery (GitHub Actions or <code>npm run discover</code>) and sync.</Empty>
          )}
        </Card>
      )}
      <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()} style={{ marginTop: '1rem' }}>
        <div className="grow"><Field label="Search"><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="title, company, skill" /></Field></div>
        <Field label="Country"><select value={f.country} onChange={(e) => set({ country: e.target.value })}><option value="">All</option>{countries.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Class"><select value={f.cls} onChange={(e) => set({ cls: e.target.value })}><option value="active">Qualified + stretch</option><option value="">All</option><option value="qualified">Qualified</option><option value="stretch">Stretch</option><option value="rejected">Rejected</option><option value="unscored">Unscored</option></select></Field>
        <Field label="Sponsorship"><select value={f.visa} onChange={(e) => set({ visa: e.target.value })}><option value="">Any</option><option value="confirmed">Confirmed</option><option value="unconfirmed">Unconfirmed</option><option value="ruled_out">Ruled out</option></select></Field>
        <Field label="India-remote"><select value={f.india} onChange={(e) => set({ india: e.target.value })}><option value="">Any</option><option value="confirmed">Confirmed</option><option value="unconfirmed">Unconfirmed</option><option value="ruled_out">Ruled out</option></select></Field>
        <Field label="Salary"><select value={f.salary} onChange={(e) => set({ salary: e.target.value })}><option value="">Any</option><option value="stated">Stated only</option></select></Field>
        <Field label="Fresh"><select value={f.fresh} onChange={(e) => set({ fresh: e.target.value })}><option value="">Any age</option><option value="3">≤ 3 days</option><option value="7">≤ 7 days</option><option value="14">≤ 14 days</option></select></Field>
        <Field label="Triage"><select value={f.triage} onChange={(e) => set({ triage: e.target.value })}><option value="active">Active</option><option value="">All</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="saved">Saved</option><option value="dismissed">Dismissed</option><option value="promoted">Promoted</option></select></Field>
        <Field label="Sort"><select value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}><option value="score">Score</option><option value="posted">Posted</option><option value="firstSeen">First seen</option><option value="company">Company</option></select></Field>
        <label className="row small"><input type="checkbox" checked={f.closed} onChange={(e) => set({ closed: e.target.checked })} /> include closed</label>
      </form>
      <div className="row small" style={{ marginBottom: '0.75rem' }}>
        <span className="muted">Saved views:</span>
        {Object.keys(views).map((n) => (
          <button key={n} className="btn btn-sm" onClick={() => setF(views[n])}>{n}</button>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          onClick={async () => {
            const name = window.prompt('Name this view');
            if (!name) return;
            const v = { ...views, [name]: f };
            setViews(v);
            await store.local.setMeta('savedJobViews', v);
          }}
        >
          + Save current
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setF(DEFAULT)}>Reset</button>
      </div>
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Score</th><th>Role</th><th className="hide-sm">Location</th><th>Eligibility</th><th className="hide-sm">Salary</th><th className="hide-sm">Seen</th><th>Triage</th></tr>
            </thead>
            <tbody>
              {list.slice(0, 300).map((j) => (
                <tr key={j.id}>
                  <td className="score">{j.score?.total ?? '–'}{j.score?.caps.length ? <span title={j.score.caps.join(' ')} aria-label="capped">*</span> : null}</td>
                  <td>
                    <a href={href('jobs', j.id)} className="title">{j.title}</a>
                    <div className="small muted">{j.company}{j.classification === 'stretch' && <> · <Badge tone="warn">stretch</Badge></>}{j.openness.status !== 'open' && <> · <Badge tone={j.openness.status === 'closed' ? 'bad' : 'warn'}>{j.openness.status.replace('_', ' ')}</Badge></>}</div>
                  </td>
                  <td className="hide-sm small">{j.location || '—'}</td>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <Badge tone={eligTone(j.eligibility.sponsorship.status)}>visa {eligLabel(j.eligibility.sponsorship.status)}</Badge>
                      <Badge tone={eligTone(j.eligibility.indiaRemote.status)}>India {eligLabel(j.eligibility.indiaRemote.status)}</Badge>
                    </div>
                  </td>
                  <td className="hide-sm small">{j.salary.status === 'stated' ? j.salary.raw : <span className="muted">unknown</span>}</td>
                  <td className="hide-sm small">{j.postedAt ? `posted ${j.postedAt.slice(0, 10)}` : 'posted ?'}<br /><span className="muted">first seen {j.firstSeenAt.slice(0, 10)}</span></td>
                  <td><Badge>{j.triage.state}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 300 && <p className="small muted" style={{ padding: '0.5rem' }}>Showing 300 of {list.length}. Narrow the filters.</p>}
        </div>
      ) : (
        <Empty title={jobs.length ? 'No jobs match these filters' : 'No jobs yet'} action={<button className="btn" onClick={() => setF({ ...DEFAULT, cls: '', triage: '' })}>Show everything</button>}>
          {jobs.length ? 'Try clearing a filter.' : 'Sync your private repository after a discovery run, or run npm run discover locally.'}
        </Empty>
      )}
    </>
  );
}

function JobDetail({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const job = store.record<Job>('job', id);
  const apps = useRecords<Application>('application');
  const [note, setNote] = useState(job?.triage.note ?? '');
  if (!job) return <Empty title="Job not found" action={<a className="btn" href={href('jobs')}>Back to jobs</a>}>It may not be synced to this device yet.</Empty>;
  const linked = apps.find((a) => a.jobId === job.id || a.url === job.canonicalUrl);

  const triage = async (state: Job['triage']['state']) => {
    const t = new Date().toISOString();
    await store.saveWithEvents(
      [{ ...job, triage: { ...job.triage, state, note: note || undefined, updatedAt: t } }],
      [{ id: newId('evt'), type: 'triage', at: t, recordedAt: t, subject: { kind: 'job', id: job.id }, actor: 'user', confirmation: 'not_applicable', data: { from: job.triage.state, to: state }, provenance: [] }],
    );
    toast(`Marked ${state}`);
  };

  const promote = async () => {
    const t = new Date().toISOString();
    const appId = nextAppId(apps);
    const app: Application = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'application',
      id: appId,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      provenance: [{ source: 'user', at: t, note: `promoted from ${job.id}` }],
      jobId: job.id,
      company: job.company,
      role: job.title,
      location: job.location,
      url: job.canonicalUrl,
      source: `discovery ${job.source.kind}:${job.source.board}`,
      jdSnapshot: job.description ? { ...job.description, sha: job.description.sha || sha1(job.description.text) } : undefined,
      workArrangement: job.workArrangement,
      employmentType: job.employmentType,
      salary: job.salary,
      eligibility: job.eligibility,
      match: { score: job.score?.total ?? null, scale: 'heuristic-relevance 0-100 (not a hiring probability)', explanation: job.score ? Object.entries(job.score.components).map(([k, c]) => `${k}: ${c.reason}`).join('; ') : '', matched: job.matchedSkills, missingEvidence: [], gaps: job.missingSkills },
      status: 'shortlisted',
      stage: 'Shortlisted from discovery',
      priority: job.countryPriority,
      nextAction: { text: 'Verify posting is open, then prepare documents', due: todayIso() },
      deadline: null,
      dates: { found: job.firstSeenAt.slice(0, 10), applied: null, lastUpdate: todayIso() },
      submission: { state: 'not_submitted', at: null },
      interviewRounds: [],
      documents: [],
      contacts: [],
      notes: note,
      prepLinks: [],
    };
    await store.saveWithEvents(
      [app, { ...job, triage: { ...job.triage, state: 'promoted', applicationId: appId, updatedAt: t } }],
      [{ id: newId('evt'), type: 'created', at: t, recordedAt: t, subject: { kind: 'application', id: appId }, actor: 'user', confirmation: 'not_applicable', data: { status: 'shortlisted', fromJob: job.id }, provenance: [] }],
    );
    toast(`Created ${appId}`);
    navigate('applications', appId);
  };

  const s = job.score;
  return (
    <>
      <PageHead
        title={job.title}
        sub={<>{job.company} · {job.location || 'location unknown'} · <a href={job.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow">open posting ↗</a></>}
        actions={
          <>
            <a className="btn" href={href('jobs')}>← All jobs</a>
            {linked ? <a className="btn btn-primary" href={href('applications', linked.id)}>Open {linked.id}</a> : <button className="btn btn-primary" onClick={promote}>Track as application</button>}
          </>
        }
      />
      <div className="grid grid-2">
        <Card title={<>Relevance {s ? <span className="score">{s.total}</span> : '–'}</>} sub="Transparent heuristic. Weights in config/scoring.json. Not an ATS score or a hiring probability.">
          {s ? (
            <table className="table">
              <thead><tr><th>Component</th><th>Score × weight</th><th>Why</th></tr></thead>
              <tbody>
                {Object.entries(s.components).map(([k, c]) => (
                  <tr key={k}><td>{k}</td><td className="mono small">{c.score.toFixed(2)} × {c.weight}</td><td className="small">{c.reason}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Not scored (imported lead or rejected before scoring).</p>
          )}
          {s?.caps.map((c) => <div key={c} className="callout callout-warn small" style={{ marginTop: '0.5rem' }}>Capped: {c}</div>)}
          {job.rejectionReasons.length > 0 && <div className="callout callout-bad small" style={{ marginTop: '0.5rem' }}>Rejected: {job.rejectionReasons.join('; ')}</div>}
          {(job as Job & { legacyScore?: { value: number; scale: string; decision: string } }).legacyScore && (
            <p className="small muted">Legacy score: {(job as Job & { legacyScore: { value: number; scale: string; decision: string } }).legacyScore.value} ({(job as Job & { legacyScore: { scale: string } }).legacyScore.scale}); decision: {(job as Job & { legacyScore: { decision: string } }).legacyScore.decision}</p>
          )}
        </Card>
        <Card title="Eligibility & facts" sub="“Unconfirmed” means the posting does not say. It never means yes.">
          <dl className="stack small" style={{ margin: 0 }}>
            {(['sponsorship', 'relocation', 'indiaRemote'] as const).map((k) => (
              <div key={k}>
                <dt><strong>{k === 'indiaRemote' ? 'Remote from India' : k}</strong> <Badge tone={eligTone(job.eligibility[k].status)}>{eligLabel(job.eligibility[k].status)}</Badge></dt>
                {job.eligibility[k].evidence && <dd className="muted" style={{ margin: 0 }}>{job.eligibility[k].evidence}</dd>}
              </div>
            ))}
            <div><dt><strong>Salary</strong></dt><dd style={{ margin: 0 }}>{job.salary.raw ?? 'not stated (unknown)'}{job.salary.status === 'third_party_estimate' && ' — third-party estimate'}</dd></div>
            <div><dt><strong>Openness</strong></dt><dd style={{ margin: 0 }}>{job.openness.status} · {job.openness.evidence} · checked {ago(job.openness.checkedAt)}</dd></div>
            <div><dt><strong>Dates</strong></dt><dd style={{ margin: 0 }}>posted {job.postedAt?.slice(0, 10) ?? 'unknown'} · first seen {job.firstSeenAt.slice(0, 10)} · last seen {job.lastSeenAt.slice(0, 10)}</dd></div>
            <div><dt><strong>German</strong></dt><dd style={{ margin: 0 }}>{job.germanRequired === null ? 'unknown' : job.germanRequired ? 'fluent German required' : 'no fluent-German requirement detected'}</dd></div>
            <div><dt><strong>Skills</strong></dt><dd style={{ margin: 0 }}>matched: {job.matchedSkills.join(', ') || '—'}{job.missingSkills.length > 0 && <><br />mismatch signals: {job.missingSkills.join(', ')}</>}</dd></div>
          </dl>
        </Card>
      </div>
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Triage" sub={`Current: ${job.triage.state}`}>
          <Field label="Note"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="btn" onClick={() => triage('reviewing')}>Reviewing</button>
            <button className="btn" onClick={() => triage('saved')}>Save</button>
            <button className="btn btn-danger" onClick={() => triage('dismissed')}>Dismiss</button>
          </div>
        </Card>
        <Card title="Job description snapshot" sub={job.description ? `captured ${job.description.capturedAt.slice(0, 10)}${job.description.truncated ? ' (truncated)' : ''}. Untrusted text, shown as plain text.` : undefined}>
          {job.description?.text ? <pre className="small" style={{ maxHeight: 420 }}>{job.description.text}</pre> : <p className="muted">No description stored.</p>}
        </Card>
      </div>
    </>
  );
}
