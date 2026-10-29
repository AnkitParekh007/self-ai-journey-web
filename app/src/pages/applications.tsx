import { useMemo, useState } from 'react';
import { APPLICATION_STATUSES, TERMINAL_STATUSES, type AppEvent, type Application, type ApplicationStatus, type Job, type Profile } from '@core/schemas';
import { applyStatusChange, followUps, formatInZone, upcomingRounds, type StatusInput } from '@core/applications';
import { matchPrompt, tailoringPrompt, interviewPrepPrompt, MatchAnalysisSchema } from '@core/prompts';
import { newId } from '@core/ids';
import { Badge, Card, CopyButton, Empty, Field, Modal, PageHead, Tabs, downloadBlob, eligLabel, eligTone, useRecords, useStore, useToast } from '../ui/components';
import { href } from '../lib/router';
import { relDays, todayIso } from '../lib/dates';
import { learningSettings, profile as getProfile } from '../state/selectors';
import { fetchRepoFile } from '../state/session';

type View = 'kanban' | 'table' | 'calendar' | 'followups';

const STATUS_TONE: Partial<Record<ApplicationStatus, 'ok' | 'warn' | 'bad' | 'info' | 'accent'>> = {
  applied: 'info',
  screening: 'accent',
  interview: 'accent',
  offer: 'ok',
  rejected: 'bad',
  ghosted: 'warn',
  withdrawn: 'warn',
};

export function ApplicationsPage({ id, query }: { id?: string; query: URLSearchParams }) {
  if (id) return <ApplicationDetail id={id} />;
  return <ApplicationBoard initial={(query.get('view') as View) ?? 'kanban'} />;
}

function ApplicationBoard({ initial }: { initial: View }) {
  const store = useStore();
  const apps = useRecords<Application>('application');
  const [view, setView] = useState<View>(initial);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'updated' | 'priority' | 'company'>('updated');
  const today = todayIso();
  const tz = learningSettings(store).displayTimezone;
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return apps
      .filter((a) => !s || `${a.id} ${a.company} ${a.role} ${a.location} ${a.status}`.toLowerCase().includes(s))
      .sort((a, b) => (sort === 'company' ? a.company.localeCompare(b.company) : sort === 'priority' ? (a.priority ?? 9) - (b.priority ?? 9) : (b.dates.lastUpdate ?? '').localeCompare(a.dates.lastUpdate ?? '')));
  }, [apps, q, sort]);
  const fu = followUps(apps, today);
  const rounds = upcomingRounds(apps, today, 60);

  return (
    <>
      <PageHead title="Applications" sub={`${apps.length} tracked · ${apps.filter((a) => !TERMINAL_STATUSES.includes(a.status)).length} active`} />
      <Tabs
        label="Application views"
        value={view}
        onChange={setView}
        tabs={[
          { id: 'kanban', label: 'Board' },
          { id: 'table', label: 'Table' },
          { id: 'calendar', label: 'Interview calendar', count: rounds.length },
          { id: 'followups', label: 'Follow-ups', count: fu.length },
        ]}
      />
      {(view === 'kanban' || view === 'table') && (
        <div className="toolbar">
          <div className="grow"><Field label="Filter"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="company, role, status" /></Field></div>
          <Field label="Sort"><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="updated">Last update</option><option value="priority">Priority</option><option value="company">Company</option></select></Field>
        </div>
      )}
      {apps.length === 0 && <Empty title="No applications yet">Promote a job from Job discovery, or sync your repository to load migrated applications.</Empty>}
      {view === 'kanban' && apps.length > 0 && (
        <div className="kanban" role="list" aria-label="Applications by status">
          {APPLICATION_STATUSES.map((st) => {
            const col = filtered.filter((a) => a.status === st);
            return (
              <section key={st} className="kcol" role="listitem" aria-label={`${st}: ${col.length}`}>
                <h3><span>{st}</span><span>{col.length}</span></h3>
                {col.map((a) => (
                  <a key={a.id} className="kcard" href={href('applications', a.id)}>
                    <div className="small mono muted">{a.id}</div>
                    <div className="title small">{a.company}</div>
                    <div className="small">{a.role}</div>
                    {a.substage && <Badge>{a.substage}</Badge>}
                    {a.nextAction.text && <div className="tiny next-action">{a.nextAction.text}{a.nextAction.due && ` · ${relDays(a.nextAction.due, today)}`}</div>}
                  </a>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {view === 'table' && apps.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ID</th><th>Company / role</th><th>Status</th><th className="hide-sm">Stage</th><th className="hide-sm">Eligibility</th><th>Next action</th><th className="hide-sm">Updated</th></tr></thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td className="mono small"><a href={href('applications', a.id)}>{a.id}</a></td>
                  <td><strong>{a.company}</strong><div className="small">{a.role}</div></td>
                  <td><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>{a.submission.state === 'user_reported' && <div className="tiny muted">submission user-reported</div>}</td>
                  <td className="hide-sm small">{a.stage}</td>
                  <td className="hide-sm"><Badge tone={eligTone(a.eligibility.sponsorship.status)}>visa {eligLabel(a.eligibility.sponsorship.status)}</Badge></td>
                  <td className="small">{a.nextAction.text}{a.nextAction.due && <div className="muted">{a.nextAction.due}</div>}</td>
                  <td className="hide-sm small">{a.dates.lastUpdate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'calendar' && (
        <Card title="Interview calendar" sub={`Next 60 days. Times in ${tz}; the interviewer's zone is shown when different.`}>
          {rounds.length ? (
            <ul className="list">
              {rounds.map(({ application: a, round: r }) => (
                <li key={a.id + r.id}>
                  <Badge tone="accent">{relDays(r.scheduledAt, today)}</Badge>
                  <div className="grow">
                    <a className="title" href={href('applications', a.id)}>{a.company} · Round {r.no}{r.name && `: ${r.name}`}</a>
                    <div className="small">{formatInZone(r.scheduledAt!, tz)}</div>
                    {r.timezone && r.timezone !== tz && <div className="small muted">{formatInZone(r.scheduledAt!, r.timezone)}</div>}
                  </div>
                  <a className="btn btn-sm" href={href('learning', 'interview', a.id)}>Prep</a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No scheduled rounds">Add a round from an application’s page when an interview is booked.</Empty>
          )}
        </Card>
      )}
      {view === 'followups' && (
        <Card title="Follow-ups" sub="Due next actions plus in-process applications with no update for 21+ days. Drafts only: you send every message yourself.">
          {fu.length ? (
            <ul className="list">
              {fu.map((f) => (
                <li key={f.applicationId + f.reason}>
                  <Badge tone={f.overdue ? 'bad' : 'warn'}>{f.due}</Badge>
                  <div className="grow"><a className="title" href={href('applications', f.applicationId)}>{f.company} — {f.role}</a><div className="next-action">{f.reason}</div></div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing to follow up" />
          )}
        </Card>
      )}
    </>
  );
}

function ApplicationDetail({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const app = store.record<Application>('application', id);
  const job = app?.jobId ? store.record<Job>('job', app.jobId) : undefined;
  const prof = getProfile(store);
  const events = useMemo(() => {
    const all = store.events().filter((e) => e.subject.kind === 'application' && e.subject.id === id);
    // Apply append-only corrections (e.g. submission evidence re-read during migration).
    const corrections = new Map(all.filter((e) => typeof e.data.corrects === 'string').map((e) => [e.data.corrects as string, e.data.confirmation as AppEvent['confirmation']]));
    return all.filter((e) => typeof e.data.corrects !== 'string').map((e) => (corrections.has(e.id) ? { ...e, confirmation: corrections.get(e.id)!, note: `${e.note ?? ''} (corrected)`.trim() } : e));
  }, [store, store.version, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [statusOpen, setStatusOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [notes, setNotes] = useState(app?.notes ?? '');
  const [next, setNext] = useState({ text: app?.nextAction.text ?? '', due: app?.nextAction.due ?? '' });
  const [deadline, setDeadline] = useState(app?.deadline ?? '');
  const tz = learningSettings(store).displayTimezone;
  if (!app) return <Empty title="Application not found" action={<a className="btn" href={href('applications')}>Back</a>} />;

  const save = async (patch: Partial<Application>, msg = 'Saved') => {
    await store.save({ ...app, ...patch });
    toast(msg);
  };

  return (
    <>
      <PageHead
        title={`${app.company} — ${app.role}`}
        sub={<><span className="mono">{app.id}</span> · {app.location || 'location unknown'} {app.url && <>· <a href={app.url} target="_blank" rel="noopener noreferrer nofollow">posting ↗</a></>}</>}
        actions={
          <>
            <a className="btn" href={href('applications')}>← All</a>
            <button className="btn btn-primary" onClick={() => setStatusOpen(true)}>Update status</button>
          </>
        }
      />
      <div className="grid grid-3">
        <Card title="Status">
          <div className="row"><Badge tone={STATUS_TONE[app.status]}>{app.status}</Badge>{app.substage && <Badge>{app.substage}</Badge>}</div>
          <p className="small" style={{ marginTop: '0.5rem' }}>{app.stage || '—'}</p>
          <p className="small muted">
            Submission: <strong>{app.submission.state.replace('_', ' ')}</strong>
            {app.submission.at && ` on ${app.submission.at}`}
            {app.submission.state === 'user_reported' && ' (no confirmation seen)'}
          </p>
          <p className="tiny muted">Generating documents never changes the status. Only your explicit updates do.</p>
        </Card>
        <Card title="Eligibility">
          {(['sponsorship', 'relocation', 'indiaRemote'] as const).map((k) => (
            <div key={k} className="small" style={{ marginBottom: '0.4rem' }}>
              <strong>{k === 'indiaRemote' ? 'Remote from India' : k}</strong> <Badge tone={eligTone(app.eligibility[k].status)}>{eligLabel(app.eligibility[k].status)}</Badge>
              {app.eligibility[k].evidence && <div className="muted tiny">{app.eligibility[k].evidence}</div>}
            </div>
          ))}
          <div className="small"><strong>Salary (as stated):</strong> {app.salary.raw ?? 'unknown'} <span className="muted">({app.salary.status.replace('_', ' ')})</span></div>
          <div className="small"><strong>Work:</strong> {app.workArrangement}{app.workArrangementRaw && ` — ${app.workArrangementRaw}`} · {app.employmentType}</div>
        </Card>
        <Card title="Match" sub={app.match.scale}>
          <p className="score">{app.match.score ?? '–'}</p>
          {app.match.explanation && <p className="small">{app.match.explanation}</p>}
          {app.match.matched.length > 0 && <p className="small"><strong>Matched:</strong> {app.match.matched.join(', ')}</p>}
          {app.match.missingEvidence.length > 0 && <p className="small"><strong>Missing evidence:</strong> {app.match.missingEvidence.join(', ')}</p>}
          {app.match.gaps.length > 0 && <p className="small"><strong>Gaps:</strong> {app.match.gaps.join(', ')}</p>}
          <button className="btn btn-sm" onClick={() => setAiOpen(true)}>AI assist (copy prompt / import result)</button>
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Next action & deadline">
          <div className="grid grid-2">
            <Field label="Next action"><input value={next.text} onChange={(e) => setNext({ ...next, text: e.target.value })} /></Field>
            <Field label="Due"><input type="date" value={next.due} onChange={(e) => setNext({ ...next, due: e.target.value })} /></Field>
            <Field label="Application deadline"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          </div>
          <button className="btn btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => save({ nextAction: { text: next.text, due: next.due || null }, deadline: deadline || null })}>Save</button>
        </Card>
        <Card title="Interview rounds">
          {app.interviewRounds.length ? (
            <ul className="list">
              {app.interviewRounds.map((r) => (
                <li key={r.id}>
                  <Badge tone={r.outcome === 'passed' ? 'ok' : r.outcome === 'failed' ? 'bad' : 'accent'}>{r.outcome}</Badge>
                  <div className="grow small">
                    <strong>Round {r.no}{r.name && `: ${r.name}`}</strong>
                    {r.scheduledAt && <div>{formatInZone(r.scheduledAt, tz)}{r.timezone && r.timezone !== tz && <span className="muted"> · {formatInZone(r.scheduledAt, r.timezone)}</span>}</div>}
                  </div>
                  <a className="btn btn-sm" href={href('learning', 'interview', app.id)}>Prep</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None yet. Use “Update status → interview round”.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Timeline" sub="Append-only history. Edits never rewrite past events.">
          {events.length ? (
            <ol className="timeline">
              {[...events].reverse().map((e) => (
                <li key={e.id}>
                  <div className="small"><strong>{e.type.replace('_', ' ')}</strong> · {e.at.slice(0, 10)} {e.confirmation !== 'not_applicable' && <Badge tone={e.confirmation === 'confirmed' ? 'ok' : 'warn'}>{e.confirmation.replace('_', ' ')}</Badge>} <span className="muted tiny">{e.actor}</span></div>
                  {e.note && <div className="small muted">{e.note}</div>}
                  {typeof e.data.from === 'string' && <div className="tiny muted">{String(e.data.from)} → {String(e.data.to)}</div>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">No events yet.</p>
          )}
        </Card>
        <Card title="Documents" sub="Drafts until you review them. Generate with the CLI: npm run cli -- prepare <id>.">
          {app.documents.length ? (
            <ul className="list">
              {app.documents.map((d) => (
                <li key={d.id}>
                  <Badge tone={d.reviewState === 'approved' ? 'ok' : d.reviewState === 'reviewed' ? 'info' : 'warn'}>{d.reviewState}</Badge>
                  <div className="grow small">
                    <strong>{d.kind.replace('_', ' ')}</strong> v{d.version} · {d.generatedAt.slice(0, 10)} · {d.generator}
                    {d.openTodos > 0 && <div><Badge tone="warn">{d.openTodos} TODO</Badge></div>}
                    <div className="row" style={{ marginTop: 4 }}>
                      {d.formats.map((fmt) => {
                        const who = (prof?.name ?? '').replace(/\s+/g, '');
                        const p = fmt === 'md' ? d.path : d.path.replace(/(resume|cover-letter)\.md$/, (m) => (m.startsWith('resume') ? `${who}_Resume.${fmt}` : `${who}_CoverLetter.${fmt}`));
                        return (
                          <button key={fmt} className="btn btn-sm" onClick={async () => { try { downloadBlob(p.split('/').pop()!, await fetchRepoFile(p)); } catch (e) { toast((e as Error).message); } }}>{fmt.toUpperCase()}</button>
                        );
                      })}
                    </div>
                  </div>
                  {d.reviewState === 'draft' && <button className="btn btn-sm" onClick={() => save({ documents: app.documents.map((x) => (x.id === d.id ? { ...x, reviewState: 'reviewed' } : x)) }, 'Marked reviewed')}>Mark reviewed</button>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No documents yet.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Recruiter contacts" sub="Only contacts published on the posting or official company pages, each with its source URL." actions={<button className="btn btn-sm" onClick={() => setContactOpen(true)}>Add</button>}>
          {app.contacts.length ? (
            <ul className="list">
              {app.contacts.map((c) => (
                <li key={c.id}><div className="grow small"><strong>{c.name}</strong>{c.title && `, ${c.title}`}<div className="muted tiny">source: <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{c.sourceUrl}</a></div></div></li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None recorded.</p>
          )}
        </Card>
        <Card title="Notes, feedback & prep">
          <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <button className="btn btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => save({ notes })}>Save notes</button>
          {app.rejectionFeedback && <div className="callout callout-bad small" style={{ marginTop: '0.75rem' }}><strong>Rejection feedback:</strong> {app.rejectionFeedback}</div>}
          {app.prepLinks.length > 0 && <p className="small">Prep files: {app.prepLinks.map((p) => <code key={p}>{p} </code>)}</p>}
          <a className="btn btn-sm" href={href('learning', 'interview', app.id)}>Interview prep pack</a>
        </Card>
      </div>

      {app.jdSnapshot && (
        <div style={{ marginTop: '1rem' }}>
          <Card title="Job description snapshot" sub={`Captured ${app.jdSnapshot.capturedAt.slice(0, 10)}. Untrusted text.`}>
            <pre className="small" style={{ maxHeight: 360 }}>{app.jdSnapshot.text}</pre>
          </Card>
        </div>
      )}

      <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} app={app} />
      <ContactDialog open={contactOpen} onClose={() => setContactOpen(false)} app={app} />
      {prof && <AiDialog open={aiOpen} onClose={() => setAiOpen(false)} app={app} job={job} profile={prof} />}
    </>
  );
}

function StatusDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: Application }) {
  const store = useStore();
  const toast = useToast();
  const [type, setType] = useState<StatusInput['type']>('applied');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [confirmation, setConfirmation] = useState<'confirmed' | 'user_reported'>('user_reported');
  const [round, setRound] = useState({ no: (app.interviewRounds.at(-1)?.no ?? 0) + 1, name: '', when: '', tz: 'Europe/Berlin', outcome: 'scheduled' as const as Application['interviewRounds'][number]['outcome'] });
  const [status, setStatus] = useState<ApplicationStatus>(app.status);
  const [substage, setSubstage] = useState(app.substage ?? '');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      let input: StatusInput;
      if (type === 'applied') input = { type, date, confirmation, note };
      else if (type === 'round') {
        const scheduledAt = round.when ? zonedToIso(round.when, round.tz) : null;
        input = { type, date, no: Number(round.no), name: round.name, scheduledAt, timezone: round.when ? round.tz : null, outcome: round.outcome, note };
      } else if (type === 'status') input = { type, date, status, substage, note };
      else if (type === 'note') input = { type, date, note };
      else input = { type, date, note, feedback: type === 'rejected' ? note : undefined } as StatusInput;
      const t = applyStatusChange(app, input);
      await store.saveWithEvents([t.application], t.events);
      toast('Status updated; history preserved');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal open={open} title={`Update ${app.id}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Record</button></>}>
      {err && <div className="callout callout-bad small" role="alert">{err}</div>}
      <Field label="What happened">
        <select value={type} onChange={(e) => setType(e.target.value as StatusInput['type'])}>
          <option value="applied">I submitted the application</option>
          <option value="screening">Recruiter replied / screening</option>
          <option value="round">Interview round scheduled or finished</option>
          <option value="offer">Offer</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">I withdrew</option>
          <option value="ghosted">No reply (ghosted)</option>
          <option value="status">Set status / substage manually</option>
          <option value="note">Add a note only</option>
        </select>
      </Field>
      <Field label="Date it happened"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {type === 'applied' && (
        <fieldset className="stack" style={{ border: 0, padding: 0 }}>
          <legend className="small"><strong>Evidence of submission</strong></legend>
          <label className="row small"><input type="radio" checked={confirmation === 'confirmed'} onChange={() => setConfirmation('confirmed')} /> I saw a confirmation page or email</label>
          <label className="row small"><input type="radio" checked={confirmation === 'user_reported'} onChange={() => setConfirmation('user_reported')} /> I submitted it but have no confirmation</label>
        </fieldset>
      )}
      {type === 'round' && (
        <div className="grid grid-2">
          <Field label="Round no."><input type="number" min={1} value={round.no} onChange={(e) => setRound({ ...round, no: Number(e.target.value) })} /></Field>
          <Field label="Name"><input value={round.name} onChange={(e) => setRound({ ...round, name: e.target.value })} placeholder="Technical peer" /></Field>
          <Field label="Local date & time"><input type="datetime-local" value={round.when} onChange={(e) => setRound({ ...round, when: e.target.value })} /></Field>
          <Field label="Time zone of that time" hint="IANA zone, e.g. Europe/Berlin, Asia/Dubai"><input value={round.tz} onChange={(e) => setRound({ ...round, tz: e.target.value })} /></Field>
          <Field label="Outcome">
            <select value={round.outcome} onChange={(e) => setRound({ ...round, outcome: e.target.value as typeof round.outcome })}>
              {['scheduled', 'done', 'passed', 'failed', 'cancelled'].map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
        </div>
      )}
      {type === 'status' && (
        <div className="grid grid-2">
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>{APPLICATION_STATUSES.filter((s) => s !== 'applied').map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Substage (optional)" hint="e.g. take-home, references, team match"><input value={substage} onChange={(e) => setSubstage(e.target.value)} /></Field>
        </div>
      )}
      <Field label={type === 'rejected' ? 'Feedback / note' : 'Note'}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

/** Convert a wall-clock time in an IANA zone to an ISO instant (with offset). */
export function zonedToIso(local: string, timeZone: string): string {
  const asUtc = new Date(`${local}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = zoned - asUtc.getTime();
  return new Date(asUtc.getTime() - offset).toISOString();
}

function ContactDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: Application }) {
  const store = useStore();
  const [c, setC] = useState({ name: '', title: '', sourceUrl: '', linkedin: '', email: '' });
  const valid = c.name.trim() && /^https?:\/\//.test(c.sourceUrl);
  return (
    <Modal
      open={open}
      title="Add a published contact"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={async () => {
              await store.save({ ...app, contacts: [...app.contacts, { id: newId('con'), name: c.name.trim(), title: c.title || undefined, sourceUrl: c.sourceUrl, linkedin: c.linkedin || undefined, email: c.email || undefined, addedAt: todayIso() }] });
              setC({ name: '', title: '', sourceUrl: '', linkedin: '', email: '' });
              onClose();
            }}
          >
            Add
          </button>
        </>
      }
    >
      <p className="small muted">Never guess email addresses. Record only what the posting or an official company page publishes.</p>
      <Field label="Name"><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
      <Field label="Title"><input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field>
      <Field label="Source URL (required)"><input type="url" value={c.sourceUrl} onChange={(e) => setC({ ...c, sourceUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="LinkedIn (if published)"><input value={c.linkedin} onChange={(e) => setC({ ...c, linkedin: e.target.value })} /></Field>
      <Field label="Email (only if published)"><input value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
    </Modal>
  );
}

function AiDialog({ open, onClose, app, job, profile }: { open: boolean; onClose: () => void; app: Application; job?: Job; profile: Profile }) {
  const store = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<'match' | 'tailor' | 'prep'>('match');
  const [result, setResult] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const prompt = kind === 'match' ? matchPrompt(app, job, profile) : kind === 'tailor' ? tailoringPrompt(app, job, profile) : interviewPrepPrompt(app, profile);
  return (
    <Modal open={open} title="AI assist (optional, no API key)" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="small muted">Copy a prompt into Claude (claude.ai or Claude Code), then paste the JSON answer back for validation. Nothing is sent from this app.</p>
      <Field label="Prompt">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="match">Requirement ↔ evidence match (JSON result)</option>
          <option value="tailor">Tailored resume + cover letter draft (Markdown)</option>
          <option value="prep">Interview prep pack (Markdown)</option>
        </select>
      </Field>
      <pre className="tiny" style={{ maxHeight: 220 }}>{prompt}</pre>
      <CopyButton text={prompt} label="Copy prompt" />
      {kind === 'match' && (
        <>
          <Field label="Paste the JSON result"><textarea value={result} onChange={(e) => setResult(e.target.value)} /></Field>
          {err && <div className="callout callout-bad small" role="alert">{err}</div>}
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              setErr(null);
              try {
                const json = JSON.parse(result.replace(/^```(json)?|```$/gm, '').trim());
                const r = MatchAnalysisSchema.parse(json);
                if (r.applicationId !== app.id) throw new Error(`result is for ${r.applicationId}, not ${app.id}`);
                const known = new Set([...profile.roles.flatMap((x) => x.highlights.map((h) => h.id)), ...profile.projects.flatMap((p) => p.claims.map((c) => c.id)), ...profile.achievements.map((a) => a.id)]);
                const unknown = r.matched.flatMap((m) => m.evidenceIds).filter((i) => !known.has(i));
                if (unknown.length) throw new Error(`result cites evidence ids that do not exist in your profile: ${unknown.join(', ')}`);
                const t = new Date().toISOString();
                const ev: AppEvent = { id: newId('evt'), type: 'note', at: t, recordedAt: t, subject: { kind: 'application', id: app.id }, actor: 'user', confirmation: 'not_applicable', data: { aiImport: 'match-analysis' }, note: 'Imported AI match analysis (validated)', provenance: [{ source: 'ai-import', at: t }] };
                await store.saveWithEvents([{ ...app, match: { ...app.match, explanation: r.summary, matched: r.matched.map((m) => `${m.requirement} [${m.evidenceIds.join(', ')}]`), missingEvidence: r.missingEvidence, gaps: r.gaps } }], [ev]);
                toast('Match analysis imported');
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Validate & import
          </button>
        </>
      )}
    </Modal>
  );
}
