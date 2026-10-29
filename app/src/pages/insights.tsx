import { useMemo } from 'react';
import { APPLICATION_STATUSES, type Application, type Job } from '@core/schemas';
import { consistency } from '@core/learning';
import { weakTopics } from '@core/srs';
import { Bar, Card, Empty, PageHead, useRecords, useStore } from '../ui/components';
import { todayIso } from '../lib/dates';
import { reviewStates } from '../state/selectors';
import { questions } from '../lib/content';

const REACHED: Record<string, number> = { lead: 0, shortlisted: 1, tailoring: 2, applied: 3, screening: 4, interview: 5, offer: 6 };

export function InsightsPage() {
  const store = useStore();
  const apps = useRecords<Application>('application');
  const jobs = useRecords<Job>('job');
  const events = store.events();
  const today = todayIso();

  const funnel = useMemo(() => {
    // How far each application got, using its event history (a rejection after an interview still counts as reaching interview).
    const reached = new Map<string, number>();
    for (const a of apps) reached.set(a.id, REACHED[a.status] ?? (a.submission.state !== 'not_submitted' ? 3 : 0));
    for (const e of events) {
      if (e.subject.kind !== 'application') continue;
      const lvl = e.type === 'applied' ? 3 : e.type === 'screening' ? 4 : e.type.startsWith('round') ? 5 : e.type === 'offer' ? 6 : -1;
      if (lvl > (reached.get(e.subject.id) ?? -1)) reached.set(e.subject.id, lvl);
    }
    const stages = ['applied', 'screening', 'interview', 'offer'] as const;
    return stages.map((s) => ({ stage: s, count: [...reached.values()].filter((v) => v >= REACHED[s]).length }));
  }, [apps, events]);

  const byStatus = APPLICATION_STATUSES.map((s) => ({ s, n: apps.filter((a) => a.status === s).length }));
  const responses = useMemo(() => {
    const out: Array<{ id: string; days: number; kind: string }> = [];
    for (const a of apps) {
      const applied = events.find((e) => e.subject.id === a.id && e.type === 'applied');
      const reply = events.find((e) => e.subject.id === a.id && ['screening', 'rejected', 'round_scheduled', 'offer'].includes(e.type) && e.at >= (applied?.at ?? ''));
      if (applied && reply) out.push({ id: a.id, days: Math.round((Date.parse(reply.at) - Date.parse(applied.at)) / 864e5), kind: reply.type });
    }
    return out;
  }, [apps, events]);
  const rejections = apps.filter((a) => a.status === 'rejected');
  const submitted = apps.filter((a) => a.submission.state !== 'not_submitted');
  const userReported = submitted.filter((a) => a.submission.state === 'user_reported').length;

  const learningDays = events.filter((e) => ['review', 'quiz_attempt', 'mock_answer', 'course_progress', 'diagnostic'].includes(e.type)).map((e) => e.at);
  const cons = consistency(learningDays, today, 30);
  const weak = weakTopics(questions.map((q) => ({ id: q.id, topic: q.topic })), reviewStates(store));

  const demand = useMemo(() => {
    const m = new Map<string, number>();
    const miss = new Map<string, number>();
    const pool = jobs.filter((j) => j.classification === 'qualified' || ['saved', 'promoted'].includes(j.triage.state));
    for (const j of pool) {
      for (const s of new Set(j.matchedSkills)) m.set(s, (m.get(s) ?? 0) + 1);
      for (const s of new Set(j.missingSkills)) miss.set(s, (miss.get(s) ?? 0) + 1);
    }
    return { pool: pool.length, top: [...m].sort((a, b) => b[1] - a[1]).slice(0, 15), gaps: [...miss].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }, [jobs]);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs.filter((x) => x.classification === 'qualified')) for (const c of j.countries.length ? j.countries : ['Remote/other']) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  if (!apps.length && !jobs.length && !learningDays.length) return <><PageHead title="Insights" /><Empty title="Not enough data yet">Insights appear once applications, jobs or learning activity exist on this device.</Empty></>;
  const maxF = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <>
      <PageHead title="Insights" sub="Counts from your own records. Small samples: treat patterns as hints, not conclusions." />
      <div className="grid grid-2">
        <Card title="Application funnel" sub={`${submitted.length} submitted (${userReported} user-reported without confirmation)`}>
          <div className="hbars">
            {funnel.map((f, i) => (
              <div key={f.stage} className="hbar">
                <span>{f.stage}{i > 0 && funnel[i - 1].count > 0 && <span className="muted tiny"> ({f.count}/{funnel[i - 1].count})</span>}</span>
                <Bar value={f.count} max={maxF} label={f.stage} />
                <span className="mono">{f.count}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: '0.5rem' }}>Conversion shown as raw counts (reached / previous stage).</p>
        </Card>
        <Card title="Current status">
          <div className="hbars">
            {byStatus.filter((b) => b.n).map((b) => (
              <div key={b.s} className="hbar"><span>{b.s}</span><Bar value={b.n} max={Math.max(1, ...byStatus.map((x) => x.n))} label={b.s} /><span className="mono">{b.n}</span></div>
            ))}
          </div>
        </Card>
        <Card title="Responses & rejections">
          {responses.length ? (
            <p className="small">{responses.length} response(s); median {[...responses].sort((a, b) => a.days - b.days)[Math.floor(responses.length / 2)].days} day(s) after applying. {responses.filter((r) => r.kind === 'rejected').length} were rejections.</p>
          ) : (
            <p className="small muted">No responses recorded yet.</p>
          )}
          {rejections.length > 0 && (
            <ul className="small">
              {rejections.map((a) => <li key={a.id}>{a.company}: {a.stage}{a.rejectionFeedback ? ` — “${a.rejectionFeedback.slice(0, 140)}”` : ''}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Learning consistency" sub="Distinct active days from review, quiz, mock and course events.">
          <div className="grid grid-3">
            <div className="stat"><span className="num">{cons.activeDays}</span><span className="lbl">active days / 30</span></div>
            <div className="stat"><span className="num">{cons.streak}</span><span className="lbl">current streak</span></div>
            <div className="stat"><span className="num">{learningDays.length}</span><span className="lbl">learning events</span></div>
          </div>
          <h3 style={{ marginTop: '1rem' }}>Weak topics</h3>
          {weak.length ? weak.slice(0, 6).map((w) => <div key={w.topic} className="small">{w.topic}: {w.lapses} lapses, {w.lowGrades} low grades</div>) : <p className="small muted">None detected yet.</p>}
        </Card>
        <Card title="Skill demand across suitable jobs" sub={`${demand.pool} qualified or saved jobs. Keyword counts, not requirements analysis.`}>
          <div className="hbars">
            {demand.top.map(([s, n]) => <div key={s} className="hbar"><span>{s}</span><Bar value={n} max={demand.top[0]?.[1] ?? 1} label={s} /><span className="mono">{n}</span></div>)}
          </div>
          {demand.gaps.length > 0 && <p className="small" style={{ marginTop: '0.5rem' }}><strong>Frequent mismatch signals:</strong> {demand.gaps.map(([s, n]) => `${s.replace(/\\b|\\/g, '')} (${n})`).join(', ')}</p>}
        </Card>
        <Card title="Qualified jobs by country">
          <div className="hbars">{countries.map(([c, n]) => <div key={c} className="hbar"><span>{c}</span><Bar value={n} max={countries[0]?.[1] ?? 1} label={c} /><span className="mono">{n}</span></div>)}</div>
        </Card>
      </div>
    </>
  );
}
