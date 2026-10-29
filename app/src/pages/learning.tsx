import { useEffect, useRef, useState } from 'react';
import { SCHEMA_VERSION, type Application, type CourseProgress, type Evidence, type LearningSettings, type MockAnswer, type Profile, type SkillState } from '@core/schemas';
import type { Question } from '@core/content';
import { planForToday, diagnosticResult } from '@core/learning';
import { dueItems, weakTopics, type Grade } from '@core/srs';
import { mockReviewPrompt, interviewPrepPrompt, MockFeedbackSchema } from '@core/prompts';
import { newId, slugify } from '@core/ids';
import { upcomingRounds } from '@core/applications';
import { Badge, Card, CopyButton, Empty, Field, Markdown, PageHead, Tabs, useRecords, useStore, useToast } from '../ui/components';
import { href, navigate } from '../lib/router';
import { todayIso } from '../lib/dates';
import { banks, catalog, diagnostic, lessons, plans, projects, questionById, questions, topics } from '../lib/content';
import { learningSettings, profile as getProfile, reviewEvent, reviewStates } from '../state/selectors';

type Tab = 'plan' | 'diagnostic' | 'courses' | 'questions' | 'flashcards' | 'quiz' | 'mock' | 'stories' | 'interview' | 'projects' | 'skills' | 'notes';

export function LearningPage({ tab, sub }: { tab?: string; sub?: string }) {
  const t = (tab as Tab) ?? 'plan';
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'plan', label: 'Plan' },
    { id: 'diagnostic', label: 'Diagnostic' },
    { id: 'courses', label: 'Courses' },
    { id: 'questions', label: 'Question bank' },
    { id: 'flashcards', label: 'Flashcards' },
    { id: 'quiz', label: 'Timed quiz' },
    { id: 'mock', label: 'Mock interview' },
    { id: 'stories', label: 'STAR stories' },
    { id: 'interview', label: 'Interview packs' },
    { id: 'projects', label: 'Portfolio projects' },
    { id: 'skills', label: 'Skills & evidence' },
    { id: 'notes', label: 'Study notes' },
  ];
  return (
    <>
      <PageHead title="Learning center" sub={`${questions.length} original questions · ${catalog.resources.length} resources · ${plans.length} plans. Practice here never counts as official course completion.`} />
      <Tabs label="Learning sections" value={t} onChange={(id) => navigate('learning', id)} tabs={tabs} />
      {t === 'plan' && <PlanTab />}
      {t === 'diagnostic' && <DiagnosticTab />}
      {t === 'courses' && <CoursesTab />}
      {t === 'questions' && <QuestionsTab focus={sub} />}
      {t === 'flashcards' && <FlashcardsTab />}
      {t === 'quiz' && <QuizTab />}
      {t === 'mock' && <MockTab qid={sub} />}
      {t === 'stories' && <StoriesTab />}
      {t === 'interview' && <InterviewTab appId={sub} />}
      {t === 'projects' && <ProjectsTab id={sub} />}
      {t === 'skills' && <SkillsTab />}
      {t === 'notes' && <NotesTab id={sub} />}
    </>
  );
}

function usePlanSettings() {
  const store = useStore();
  const s = learningSettings(store);
  const apps = useRecords<Application>('application');
  const rounds = upcomingRounds(apps, todayIso(), 30);
  const interviewDates = [
    ...s.interviewDates,
    ...rounds.map((r) => ({ date: r.round.scheduledAt!.slice(0, 10), applicationId: r.application.id, label: `${r.application.company} round ${r.round.no}` })),
  ];
  return { store, s, interviewDates };
}

function PlanTab() {
  const { store, s, interviewDates } = usePlanSettings();
  const toast = useToast();
  const [minutes, setMinutes] = useState(s.dailyMinutes);
  const [start, setStart] = useState(s.startDate ?? todayIso());
  const [planId, setPlanId] = useState(s.plan);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const tested = store.records<SkillState>('skill-state').filter((x) => x.testedOut).map((x) => x.skill);
  if (!plan) return <Empty title="No plans bundled" />;
  const today = planForToday(plan, { dailyMinutes: minutes, startDate: start, interviewDates }, todayIso(), { testedOut: tested });
  return (
    <div className="grid grid-2">
      <Card title="Settings" sub="Default is two hours a day. Interviews within 7 days automatically take priority.">
        <div className="grid grid-3">
          <Field label="Plan"><select value={planId} onChange={(e) => setPlanId(e.target.value as LearningSettings['plan'])}>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
          <Field label="Minutes per day"><input type="number" min={15} max={720} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
          <Field label="Start date"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} onClick={async () => { await store.save({ ...s, dailyMinutes: minutes, startDate: start, plan: planId }); toast('Plan settings saved'); }}>Save</button>
        {interviewDates.length > 0 && <p className="small" style={{ marginTop: '0.75rem' }}>Upcoming interviews: {interviewDates.map((i) => `${i.label} (${i.date})`).join(', ')}</p>}
      </Card>
      <Card title={`Today: day ${today.dayNumber} of ${today.totalDays}`} sub={`${today.focus} · ${today.minutes} min`}>
        <ul className="list">
          {today.blocks.map((b, i) => (
            <li key={i}><Badge tone="accent">{b.minutes}m</Badge><div className="grow small"><strong>{b.kind}</strong> — {b.task}{b.resourceIds.length > 0 && <div className="tiny muted">resources: {b.resourceIds.join(', ')}</div>}</div></li>
          ))}
        </ul>
        <p className="small"><strong>Deliverable:</strong> {today.deliverable}</p>
        {today.notes.length > 0 && <p className="tiny muted">{today.notes.join(' ')}</p>}
      </Card>
      <div style={{ gridColumn: '1 / -1' }}>
        <Card title={plan.title} sub={`${plan.days.length} days at ${plan.baselineMinutesPerDay} minutes baseline`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Day</th><th>Focus</th><th>Track</th><th>Topics</th><th>Deliverable</th></tr></thead>
              <tbody>
                {plan.days.map((d) => (
                  <tr key={d.day} aria-current={d.day === today.dayNumber ? 'true' : undefined} style={d.day === today.dayNumber ? { background: 'var(--accent-soft)' } : undefined}>
                    <td>{d.day}</td><td className="small">{d.focus}</td><td className="small">{d.track}</td><td className="small">{d.topics.join(', ')}</td><td className="small">{d.deliverable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function DiagnosticTab() {
  const store = useStore();
  const toast = useToast();
  const [scores, setScores] = useState<Record<string, number[]>>({});
  const [topicIdx, setTopicIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [show, setShow] = useState(false);
  const topic = diagnostic.topics[topicIdx];
  if (!topic) return <Empty title="Diagnostic complete or empty" />;
  const q = questionById.get(topic.probeQuestionIds[qIdx]);
  const record = (s: number) => {
    const arr = [...(scores[topic.topic] ?? []), s];
    const nextScores = { ...scores, [topic.topic]: arr };
    setScores(nextScores);
    setShow(false);
    if (qIdx + 1 < topic.probeQuestionIds.length) setQIdx(qIdx + 1);
    else if (topicIdx + 1 < diagnostic.topics.length) {
      setTopicIdx(topicIdx + 1);
      setQIdx(0);
    } else finish(nextScores);
  };
  const finish = async (all: Record<string, number[]>) => {
    const res = diagnosticResult(all);
    const t = new Date().toISOString();
    for (const tp of res.testedOut) {
      const sid = slugify(tp);
      const cur = store.record<SkillState>('skill-state', sid);
      await store.save({ ...(cur ?? { schemaVersion: SCHEMA_VERSION, kind: 'skill-state', id: sid, createdAt: t, updatedAt: t, deletedAt: null, provenance: [], skill: tp, confidence: null, notes: '' }), testedOut: true } as SkillState);
    }
    await store.appendEvents([{ id: newId('evt'), type: 'diagnostic', at: t, recordedAt: t, subject: { kind: 'learning', id: 'diagnostic' }, actor: 'user', confirmation: 'not_applicable', data: { scores: all, ...res }, provenance: [] }]);
    toast(`Diagnostic saved: tested out of ${res.testedOut.length} topic(s)`);
    setTopicIdx(diagnostic.topics.length);
  };
  return (
    <Card title={`Diagnostic: ${topic.topic}`} sub={`Topic ${topicIdx + 1} of ${diagnostic.topics.length} · ${topic.testOutRule}`}>
      {q ? (
        <>
          <p><strong>{q.question}</strong></p>
          <p className="small muted">Answer aloud or on paper first, then reveal and rate yourself honestly. 0 = could not answer, 1 = partial, 2 = solid, 3 = could teach it.</p>
          {show ? (
            <>
              <div className="callout small"><Markdown text={q.spokenAnswer} /></div>
              <div className="row">{[0, 1, 2, 3].map((s) => <button key={s} className="btn" onClick={() => record(s)}>{s}</button>)}</div>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setShow(true)}>Reveal reference answer</button>
          )}
        </>
      ) : (
        <p>Probe question missing: {topic.probeQuestionIds[qIdx]}</p>
      )}
      <button className="btn btn-sm btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => { setTopicIdx(topicIdx + 1); setQIdx(0); setShow(false); }}>Skip topic</button>
    </Card>
  );
}

function CoursesTab() {
  const store = useStore();
  const toast = useToast();
  const progress = useRecords<CourseProgress>('course-progress');
  const [track, setTrack] = useState('');
  const byId = new Map(progress.map((p) => [p.resourceId, p]));
  const list = catalog.resources.filter((r) => !track || r.track === track).sort((a, b) => a.priority - b.priority);
  const update = async (resourceId: string, patch: Partial<CourseProgress>) => {
    const cur = byId.get(resourceId);
    const t = new Date().toISOString();
    const rec: CourseProgress = { ...(cur ?? { schemaVersion: SCHEMA_VERSION, kind: 'course-progress', id: resourceId, createdAt: t, updatedAt: t, deletedAt: null, provenance: [], resourceId, status: 'not_started', plannedHours: null, spentHours: 0, notes: '' }), ...patch } as CourseProgress;
    await store.saveWithEvents([rec], [{ id: newId('evt'), type: 'course_progress', at: t, recordedAt: t, subject: { kind: 'course', id: resourceId }, actor: 'user', confirmation: 'not_applicable', data: { ...patch }, provenance: [] }]);
    toast('Progress saved');
  };
  return (
    <>
      <div className="callout small">
        {catalog.notes.map((n) => <div key={n}>{n}</div>)}
      </div>
      <div className="toolbar"><Field label="Track"><select value={track} onChange={(e) => setTrack(e.target.value)}><option value="">Both</option><option value="applied-ai">Applied AI & agents</option><option value="frontend-fullstack">AI-ready frontend & full-stack</option></select></Field></div>
      <div className="grid grid-2">
        {list.map((r) => {
          const p = byId.get(r.id);
          return (
            <Card key={r.id} title={<a href={r.url} target="_blank" rel="noopener noreferrer">{r.title} ↗</a>} sub={`${r.provider} · ${r.kind} · priority ${r.priority}`}>
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <Badge tone={r.cost.access === 'free' || r.cost.access === 'free-with-account' ? 'ok' : r.cost.access === 'paid' ? 'bad' : 'warn'}>access: {r.cost.access}</Badge>
                <Badge tone={r.cost.apiUsageNeeded === 'none' ? 'ok' : 'warn'}>API cost: {r.cost.apiUsageNeeded}</Badge>
                <Badge>cert: {r.cost.certification}</Badge>
                <Badge tone={r.verification.status === 'verified' ? 'ok' : 'warn'} title={`${r.verification.method}${r.verification.checkedAt ? ` (${r.verification.checkedAt})` : ''}`}>{r.verification.status}</Badge>
              </div>
              <p className="small"><strong>Topics:</strong> {r.topics.join(', ')}{r.prerequisites.length > 0 && <><br /><strong>Prerequisites:</strong> {r.prerequisites.join(', ')}</>}</p>
              <p className="small"><strong>Stated duration:</strong> {r.statedDuration ?? 'not verified'} · <strong>Your planned effort:</strong> {p?.plannedHours ?? r.plannedHours} h · spent {p?.spentHours ?? 0} h</p>
              <p className="small"><strong>Hands-on deliverable:</strong> {r.deliverable}</p>
              <p className="small"><strong>Interview competencies:</strong> {r.competencies.join(', ')}</p>
              {r.cost.note && <p className="tiny muted">{r.cost.note}</p>}
              <div className="grid grid-3">
                <Field label="Status">
                  <select value={p?.status ?? 'not_started'} onChange={(e) => update(r.id, { status: e.target.value as CourseProgress['status'] })}>
                    <option value="not_started">not started</option><option value="planned">planned</option><option value="in_progress">in progress</option><option value="completed_self_reported">completed (self-reported)</option><option value="tested_out">tested out</option><option value="dropped">dropped</option>
                  </select>
                </Field>
                <Field label="Hours spent"><input type="number" min={0} step={0.5} defaultValue={p?.spentHours ?? 0} onBlur={(e) => update(r.id, { spentHours: Number(e.target.value) })} /></Field>
                <Field label="Planned hours"><input type="number" min={0} step={0.5} defaultValue={p?.plannedHours ?? r.plannedHours} onBlur={(e) => update(r.id, { plannedHours: Number(e.target.value) })} /></Field>
              </div>
              <Field label="Completion evidence / badge link you were issued" hint="The app never awards completion; paste the provider's certificate or badge URL.">
                <input type="url" defaultValue={p?.completionEvidenceUrl ?? ''} onBlur={(e) => e.target.value !== (p?.completionEvidenceUrl ?? '') && update(r.id, { completionEvidenceUrl: e.target.value || undefined })} />
              </Field>
              <Field label="Deliverable link (repo, commit, write-up)"><input type="url" defaultValue={p?.deliverableUrl ?? ''} onBlur={(e) => e.target.value !== (p?.deliverableUrl ?? '') && update(r.id, { deliverableUrl: e.target.value || undefined })} /></Field>
              <Field label="Notes"><textarea defaultValue={p?.notes ?? ''} onBlur={(e) => e.target.value !== (p?.notes ?? '') && update(r.id, { notes: e.target.value })} /></Field>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function QuestionView({ q, open = false }: { q: Question; open?: boolean }) {
  return (
    <details open={open} className="card" style={{ marginBottom: '0.6rem' }} id={`q-${q.id}`}>
      <summary>
        {q.question} <span className="tiny muted">· {q.topic} · {q.difficulty} · {q.format}</span>
      </summary>
      <div className="stack small" style={{ marginTop: '0.6rem' }}>
        <div><strong>Roles:</strong> {q.roles.join(', ')}</div>
        <div><strong>Interviewer intent:</strong> {q.intent}</div>
        {q.choices && <ol type="A">{q.choices.map((c, i) => <li key={i}>{c}{i === q.answerIndex && ' ✓'}</li>)}</ol>}
        <div><strong>Spoken answer (~60–90 s):</strong><Markdown text={q.spokenAnswer} /></div>
        <div><strong>Deeper explanation:</strong><Markdown text={q.deepDive} /></div>
        <div><strong>Practical example:</strong><Markdown text={q.example} /></div>
        <div><strong>Trade-offs:</strong><ul>{q.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul></div>
        <div><strong>Common mistakes:</strong><ul>{q.mistakes.map((t) => <li key={t}>{t}</li>)}</ul></div>
        <div><strong>Follow-ups:</strong><ul>{q.followUps.map((t) => <li key={t}>{t}</li>)}</ul></div>
        <div><strong>Rubric:</strong><ul>{q.rubric.map((r) => <li key={r.criterion}><em>{r.criterion}</em>: {r.strong}</li>)}</ul></div>
        {q.sources.length > 0 && <div><strong>Sources:</strong> {q.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>{s.title}</a>)}</div>}
        <div><a className="btn btn-sm" href={href('learning', 'mock', q.id)}>Practice as mock answer</a></div>
      </div>
    </details>
  );
}

function QuestionsTab({ focus }: { focus?: string }) {
  const store = useStore();
  const states = reviewStates(store);
  const [f, setF] = useState({ q: '', track: '', topic: '', diff: '', format: '' });
  const list = questions.filter((q) => (!f.q || `${q.question} ${q.tags.join(' ')}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.track || q.track === f.track) && (!f.topic || q.topic === f.topic) && (!f.diff || q.difficulty === f.diff) && (!f.format || q.format === f.format));
  return (
    <>
      <div className="toolbar">
        <div className="grow"><Field label="Search"><input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field></div>
        <Field label="Track"><select value={f.track} onChange={(e) => setF({ ...f, track: e.target.value })}><option value="">Both</option><option value="applied-ai">Applied AI</option><option value="frontend-fullstack">Frontend/full-stack</option></select></Field>
        <Field label="Topic"><select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="">All</option>{topics.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Difficulty"><select value={f.diff} onChange={(e) => setF({ ...f, diff: e.target.value })}><option value="">All</option>{['foundation', 'intermediate', 'senior', 'staff'].map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Format"><select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="">All</option><option value="subjective">Architecture / subjective</option><option value="objective">Objective quiz</option></select></Field>
      </div>
      <p className="small muted">{list.length} questions in {banks.length} banks. {[...states.keys()].length} reviewed at least once.</p>
      {list.map((q) => <QuestionView key={q.id} q={q} open={q.id === focus} />)}
    </>
  );
}

function FlashcardsTab() {
  const store = useStore();
  const toast = useToast();
  const states = reviewStates(store);
  const today = todayIso();
  const [topic, setTopic] = useState('');
  const pool = questions.filter((q) => !topic || q.topic === topic);
  const due = dueItems(pool.map((q) => q.id), states, today, 200);
  const fresh = pool.filter((q) => !states.has(q.id)).slice(0, 10);
  const queue = [...due.map((d) => questionById.get(d.itemId)!), ...fresh].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = queue[idx];
  const grade = async (g: Grade) => {
    await store.appendEvents([reviewEvent(card.id, g, { mode: 'flashcard', topic: card.topic })]);
    setFlipped(false);
    setIdx((i) => i + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (flipped && ['1', '2', '3', '4'].includes(e.key)) grade(([1, 3, 4, 5] as Grade[])[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <>
      <div className="toolbar">
        <Field label="Topic"><select value={topic} onChange={(e) => { setTopic(e.target.value); setIdx(0); }}><option value="">All topics</option>{topics.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <span className="small muted">{due.length} due · {fresh.length} new in this session · keys: <span className="kbd">Space</span> flip, <span className="kbd">1</span>–<span className="kbd">4</span> grade</span>
      </div>
      {card ? (
        <Card title={`Card ${idx + 1} of ${queue.length}`} sub={`${card.topic} · ${card.difficulty}`}>
          <div className="flashcard" aria-live="polite">
            <strong>{card.question}</strong>
            {flipped && <Markdown text={card.spokenAnswer} />}
          </div>
          {!flipped ? (
            <button className="btn btn-primary" onClick={() => setFlipped(true)}>Show answer</button>
          ) : (
            <div className="row">
              <button className="btn btn-danger" onClick={() => grade(1)}>1 · Forgot</button>
              <button className="btn" onClick={() => grade(3)}>2 · Hard</button>
              <button className="btn" onClick={() => grade(4)}>3 · Good</button>
              <button className="btn" onClick={() => grade(5)}>4 · Easy</button>
              <a className="btn btn-ghost btn-sm" href={href('learning', 'questions', card.id)}>Full answer</a>
            </div>
          )}
        </Card>
      ) : (
        <Empty title="All caught up" action={<button className="btn" onClick={() => { setIdx(0); toast('Queue refreshed'); }}>Refresh queue</button>}>Come back tomorrow for the next due cards, or pick another topic.</Empty>
      )}
    </>
  );
}

function QuizTab() {
  const store = useStore();
  const objective = questions.filter((q) => q.format === 'objective');
  const [topic, setTopic] = useState('');
  const [n, setN] = useState(10);
  const [secs, setSecs] = useState(60);
  const [run, setRun] = useState<{ qs: Question[]; i: number; answers: Array<number | null>; started: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const startTimer = () => {
    setLeft(secs);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
  };
  useEffect(() => {
    if (run && left === 0 && !revealed) setRevealed(true);
  }, [left, run, revealed]);
  const start = () => {
    const pool = objective.filter((q) => !topic || q.topic === topic);
    const qs = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    setRun({ qs, i: 0, answers: [], started: Date.now() });
    setPicked(null);
    setRevealed(false);
    startTimer();
  };
  if (!run) {
    return (
      <Card title="Timed quiz" sub={`${objective.length} objective questions. Each answer is also logged as a spaced-repetition review.`}>
        <div className="grid grid-3">
          <Field label="Topic"><select value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">All</option>{[...new Set(objective.map((q) => q.topic))].sort().map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Questions"><input type="number" min={3} max={40} value={n} onChange={(e) => setN(Number(e.target.value))} /></Field>
          <Field label="Seconds per question"><input type="number" min={15} max={300} value={secs} onChange={(e) => setSecs(Number(e.target.value))} /></Field>
        </div>
        <button className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={!objective.length} onClick={start}>Start</button>
      </Card>
    );
  }
  const q = run.qs[run.i];
  if (!q) {
    const correct = run.answers.filter((a, i) => a === run.qs[i].answerIndex).length;
    return (
      <Card title={`Result: ${correct} / ${run.qs.length}`} sub="Practice score only. It is not a certification or course completion.">
        <ul className="list">{run.qs.map((x, i) => <li key={x.id}><Badge tone={run.answers[i] === x.answerIndex ? 'ok' : 'bad'}>{run.answers[i] === x.answerIndex ? 'correct' : 'wrong'}</Badge><div className="grow small"><a href={href('learning', 'questions', x.id)}>{x.question}</a></div></li>)}</ul>
        <button className="btn" onClick={() => setRun(null)}>New quiz</button>
      </Card>
    );
  }
  const next = async () => {
    const ok = picked === q.answerIndex;
    await store.appendEvents([reviewEvent(q.id, ok ? 4 : 1, { mode: 'quiz', topic: q.topic, picked, timedOut: picked === null })]);
    const answers = [...run.answers, picked];
    if (run.i + 1 >= run.qs.length) {
      const t = new Date().toISOString();
      await store.appendEvents([{ id: newId('evt'), type: 'quiz_attempt', at: t, recordedAt: t, subject: { kind: 'quiz', id: topic || 'all' }, actor: 'user', confirmation: 'not_applicable', data: { total: run.qs.length, correct: answers.filter((a, i) => a === run.qs[i].answerIndex).length, seconds: Math.round((Date.now() - run.started) / 1000) }, provenance: [] }]);
    }
    setRun({ ...run, i: run.i + 1, answers });
    setPicked(null);
    setRevealed(false);
    startTimer();
  };
  return (
    <Card title={`Question ${run.i + 1} of ${run.qs.length}`} sub={`${q.topic} · ${left}s left`}>
      <p><strong>{q.question}</strong></p>
      <fieldset className="stack" style={{ border: 0, padding: 0 }} disabled={revealed}>
        <legend className="sr-only">Choices</legend>
        {q.choices!.map((c, i) => (
          <label key={i} className={`choice${revealed ? (i === q.answerIndex ? ' correct' : i === picked ? ' wrong' : '') : ''}`}>
            <input type="radio" name={`q-${q.id}`} checked={picked === i} onChange={() => setPicked(i)} /> <span>{c}</span>
          </label>
        ))}
      </fieldset>
      {revealed && <div className="callout small" style={{ marginTop: '0.75rem' }}><Markdown text={q.spokenAnswer} /></div>}
      <div className="row" style={{ marginTop: '0.75rem' }}>
        {!revealed ? <button className="btn btn-primary" onClick={() => setRevealed(true)} disabled={picked === null}>Check</button> : <button className="btn btn-primary" onClick={next}>Next</button>}
      </div>
    </Card>
  );
}

function MockTab({ qid }: { qid?: string }) {
  const store = useStore();
  const toast = useToast();
  const subjective = questions.filter((q) => q.format === 'subjective');
  const [q, setQ] = useState<Question | undefined>(qid ? questionById.get(qid) : undefined);
  const [answer, setAnswer] = useState('');
  const [mode, setMode] = useState<MockAnswer['mode']>('typed');
  const [started, setStarted] = useState<number | null>(null);
  const [self, setSelf] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<MockAnswer | null>(null);
  const [fb, setFb] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const history = useRecords<MockAnswer>('mock-answer').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  useEffect(() => { if (qid) setQ(questionById.get(qid)); }, [qid]);
  const pick = () => setQ(subjective[Math.floor(Math.random() * subjective.length)]);
  if (!q) {
    return (
      <>
        <Card title="Mock interview" sub="Answer aloud (record yourself with any recorder) or type, then self-assess against the rubric. Optional: export a prompt for Claude and import its feedback.">
          <button className="btn btn-primary" onClick={pick}>Random architecture question</button>
        </Card>
        {history.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <Card title="Previous mock answers">
              <ul className="list">{history.slice(0, 20).map((h) => <li key={h.id}><div className="grow small"><a href={href('learning', 'mock', h.questionId)}>{questionById.get(h.questionId)?.question ?? h.questionId}</a><div className="muted tiny">{h.createdAt.slice(0, 10)} · self: {Object.values(h.selfScores).reduce((s, x) => s + x, 0)}/{Object.keys(h.selfScores).length * 3}{h.aiFeedback && ' · AI feedback imported'}</div></div></li>)}</ul>
            </Card>
          </div>
        )}
      </>
    );
  }
  const elapsed = started ? Math.round((Date.now() - started) / 1000) : 0;
  const save = async () => {
    const t = new Date().toISOString();
    const rec: MockAnswer = { schemaVersion: SCHEMA_VERSION, kind: 'mock-answer', id: newId('mock'), createdAt: t, updatedAt: t, deletedAt: null, provenance: [], questionId: q.id, mode, answer, durationSec: started ? elapsed : null, selfScores: self };
    const total = Object.values(self).reduce((s, x) => s + x, 0);
    const grade = Math.round((total / Math.max(1, q.rubric.length * 3)) * 5) as Grade;
    await store.save(rec);
    await store.appendEvents([reviewEvent(q.id, Math.max(0, Math.min(5, grade)), { mode: 'mock', topic: q.topic })]);
    setSaved(rec);
    toast('Mock answer saved');
  };
  return (
    <div className="grid grid-2">
      <Card title="Question" sub={`${q.topic} · ${q.difficulty} · ${q.roles.join(', ')}`} actions={<button className="btn btn-sm" onClick={() => { pick(); setAnswer(''); setSelf({}); setSaved(null); setStarted(null); }}>Another</button>}>
        <p><strong>{q.question}</strong></p>
        <p className="small muted">Intent: {q.intent}</p>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setStarted(Date.now())}>{started ? 'Restart timer' : 'Start timer'}</button>
          <span className="small muted">Aim for 2–3 minutes spoken.</span>
        </div>
        <Field label="Mode"><select value={mode} onChange={(e) => setMode(e.target.value as MockAnswer['mode'])}><option value="typed">Typed answer</option><option value="spoken-notes">Spoke aloud; notes below</option><option value="recorded-elsewhere">Recorded elsewhere; transcript/notes below</option></select></Field>
        <Field label="Your answer"><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ minHeight: 220 }} /></Field>
      </Card>
      <Card title="Self-assessment" sub="0 missing · 1 partial · 2 solid · 3 excellent">
        {q.rubric.map((r) => (
          <div key={r.criterion} style={{ marginBottom: '0.6rem' }}>
            <div className="small"><strong>{r.criterion}</strong> — strong: {r.strong}</div>
            <div className="row" role="radiogroup" aria-label={r.criterion}>
              {[0, 1, 2, 3].map((s) => <label key={s} className="row small"><input type="radio" name={`r-${r.criterion}`} checked={self[r.criterion] === s} onChange={() => setSelf({ ...self, [r.criterion]: s })} />{s}</label>)}
            </div>
          </div>
        ))}
        <button className="btn btn-primary" disabled={!answer.trim() || Object.keys(self).length < q.rubric.length || !!saved} onClick={save}>Save attempt</button>
        <details style={{ marginTop: '0.75rem' }}><summary>Reference answer</summary><QuestionView q={q} open /></details>
        <div style={{ marginTop: '0.75rem' }}>
          <strong className="small">Optional Claude review (no API key)</strong>
          <div className="row" style={{ margin: '0.4rem 0' }}><CopyButton text={mockReviewPrompt(q, answer)} label="Copy review prompt" /></div>
          {saved && (
            <>
              <Field label="Paste Claude's JSON feedback"><textarea value={fb} onChange={(e) => setFb(e.target.value)} /></Field>
              {err && <div className="callout callout-bad small">{err}</div>}
              <button
                className="btn btn-sm"
                onClick={async () => {
                  setErr(null);
                  try {
                    const r = MockFeedbackSchema.parse(JSON.parse(fb.replace(/^```(json)?|```$/gm, '').trim()));
                    if (r.questionId !== q.id) throw new Error('feedback is for a different question');
                    await store.save({ ...saved, aiFeedback: { importedAt: new Date().toISOString(), summary: `${r.summary}\n\nImprove: ${r.improvements.join('; ')}`, scores: r.scores } });
                    toast('Feedback imported');
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                Validate & import
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function StoriesTab() {
  const store = useStore();
  const prof = getProfile(store);
  if (!prof) return <Empty title="No profile on this device">Sync your private repository to practice STAR/CAR stories grounded in your verified profile.</Empty>;
  return (
    <>
      <div className="callout small">Stories marked <strong>draft</strong> or <strong>todo</strong> are not confirmed. Confirm each happened as described before using it in an interview. Practice structure: Situation → Task → Action → Result (or Context → Action → Result), 2 minutes, end with what you learned.</div>
      <div className="grid grid-2">
        {prof.stories.map((s) => (
          <Card key={s.id} title={s.id.replace('story-', '').replace(/-/g, ' ')} sub={s.tags.join(', ')} actions={<Badge tone={s.status === 'verified' || s.status === 'user_confirmed' ? 'ok' : 'warn'}>{s.status}</Badge>}>
            <p className="small">{s.text}</p>
            <StoryPractice id={s.id} />
          </Card>
        ))}
      </div>
    </>
  );
}

function StoryPractice({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  return (
    <>
      <Field label="Your STAR draft (evidence only)"><textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <button className="btn btn-sm" disabled={!text.trim()} onClick={async () => { const t = new Date().toISOString(); await store.save({ schemaVersion: SCHEMA_VERSION, kind: 'mock-answer', id: newId('story'), createdAt: t, updatedAt: t, deletedAt: null, provenance: [], questionId: `story:${id}`, mode: 'typed', answer: text, durationSec: null, selfScores: {} } satisfies MockAnswer); setText(''); toast('Story practice saved'); }}>Save practice</button>
    </>
  );
}

function InterviewTab({ appId }: { appId?: string }) {
  const store = useStore();
  const apps = useRecords<Application>('application').filter((a) => ['screening', 'interview', 'applied', 'tailoring', 'shortlisted'].includes(a.status));
  const app = appId ? store.record<Application>('application', appId) : undefined;
  const prof = getProfile(store);
  if (!app) {
    return (
      <Card title="Company- and round-specific packs" sub="Pick an application to build a pack from its JD snapshot, company notes and your verified evidence.">
        {apps.length ? <ul className="list">{apps.map((a) => <li key={a.id}><div className="grow"><a href={href('learning', 'interview', a.id)}>{a.company} — {a.role}</a> <Badge>{a.status}</Badge></div></li>)}</ul> : <Empty title="No active applications" />}
      </Card>
    );
  }
  const jd = (app.jdSnapshot?.text ?? '').toLowerCase();
  const relevant = questions
    .map((q) => ({ q, hits: [q.topic, ...q.tags].filter((t) => jd.includes(t.toLowerCase())).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 12)
    .map((x) => x.q);
  const company = store.records<{ id: string; name: string; interviewExpectations: Array<{ text: string; label: string; sourceUrl?: string }> }>('company').find((c) => c.name.toLowerCase() === app.company.toLowerCase().replace(/\s*\(.*\)/, ''));
  const round = app.interviewRounds.find((r) => r.outcome === 'scheduled');
  return (
    <>
      <PageHead title={`Prep pack: ${app.company}`} sub={`${app.role}${round ? ` · next: round ${round.no} ${round.name}` : ''}`} actions={<a className="btn" href={href('applications', app.id)}>Open application</a>} />
      <div className="grid grid-2">
        <Card title="Expectations" sub="Sourced items cite a public URL; everything else is inferred.">
          {company?.interviewExpectations.length ? company.interviewExpectations.map((e, i) => <div key={i} className="small"><Badge tone={e.label === 'sourced' ? 'ok' : 'warn'}>{e.label}</Badge> {e.text}</div>) : <p className="small muted">None recorded. Add them on the company page.</p>}
          <h3 style={{ marginTop: '1rem' }}>Gaps to prepare honestly</h3>
          <p className="small">{app.match.gaps.join(', ') || 'Run the match analysis from the application page.'}</p>
        </Card>
        <Card title="Practice questions matched to the JD" sub="Deterministic keyword match against topics and tags.">
          {relevant.length ? <ul className="list">{relevant.map((q) => <li key={q.id}><div className="grow small"><a href={href('learning', 'mock', q.id)}>{q.question}</a> <span className="muted tiny">{q.topic}</span></div></li>)}</ul> : <p className="small muted">No JD snapshot or no matches. Browse the question bank.</p>}
        </Card>
        <Card title="Stories to rehearse">
          {prof ? prof.stories.map((s) => <div key={s.id} className="small" style={{ marginBottom: 6 }}><Badge tone={s.status === 'draft' || s.status === 'todo' ? 'warn' : 'ok'}>{s.status}</Badge> {s.text.slice(0, 160)}…</div>) : <p className="small muted">Sync your profile.</p>}
        </Card>
        <Card title="Optional: full pack with Claude">
          {prof && <><pre className="tiny" style={{ maxHeight: 200 }}>{interviewPrepPrompt(app, prof, round ? `round ${round.no} (${round.name})` : undefined)}</pre><CopyButton text={interviewPrepPrompt(app, prof, round ? `round ${round.no} (${round.name})` : undefined)} label="Copy prompt" /></>}
          <p className="tiny muted">Or run <code>npm run cli -- interview-prep {app.id}</code> to write a Markdown pack into the repository.</p>
        </Card>
      </div>
    </>
  );
}

function ProjectsTab({ id }: { id?: string }) {
  const ids = Object.keys(projects).sort();
  const cur = id && projects[id] ? id : ids[0];
  if (!cur) return <Empty title="No projects bundled" />;
  const files = projects[cur].sort((a, b) => (a.file === 'README.md' ? -1 : b.file === 'README.md' ? 1 : a.file.localeCompare(b.file)));
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 240px) 1fr' }}>
      <nav aria-label="Projects" className="stack">
        {ids.map((p) => <a key={p} className={`btn ${p === cur ? 'btn-primary' : ''}`} href={href('learning', 'projects', p)}>{p}</a>)}
        <p className="tiny muted">Mock providers and synthetic data only: zero API cost. Track evidence in Skills & evidence.</p>
      </nav>
      <div className="stack">
        {files.map((f) => <Card key={f.file} title={f.file}><Markdown text={f.text} /></Card>)}
      </div>
    </div>
  );
}

function SkillsTab() {
  const store = useStore();
  const toast = useToast();
  const states = reviewStates(store);
  const skillStates = useRecords<SkillState>('skill-state');
  const evidence = useRecords<Evidence>('evidence');
  const courses = useRecords<CourseProgress>('course-progress');
  const weak = weakTopics(questions.map((q) => ({ id: q.id, topic: q.topic })), states);
  const [ev, setEv] = useState({ title: '', url: '', type: 'commit' as Evidence['type'], skill: topics[0] ?? '', context: 'learning' as Evidence['context'] });
  const rows = topics.map((t) => {
    const qs = questions.filter((q) => q.topic === t);
    const reviewed = qs.filter((q) => states.has(q.id));
    const recent = reviewed.flatMap((q) => states.get(q.id)!.history.slice(-1));
    const good = recent.filter((h) => h.grade >= 4).length;
    const st = skillStates.find((s) => s.skill === t);
    return { topic: t, total: qs.length, reviewed: reviewed.length, good, st, ev: evidence.filter((e) => e.skills.includes(t)) };
  });
  return (
    <>
      <div className="callout small">Three separate signals, never merged into an invented “readiness %”: <strong>self-rated confidence</strong>, <strong>practice results</strong> (your latest review grades), and <strong>evidence</strong> (links to commits, tests, write-ups, demos). Course completion is tracked separately in Courses and only counts with a link you supply.</div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Topic</th><th>Practice (latest grade ≥ good / reviewed / total)</th><th>Confidence (0–5)</th><th>Tested out</th><th>Evidence</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.topic}>
                <td>{r.topic}</td>
                <td className="small">{r.good} / {r.reviewed} / {r.total}</td>
                <td>
                  <select
                    aria-label={`Confidence for ${r.topic}`}
                    value={r.st?.confidence ?? ''}
                    onChange={async (e) => {
                      const t = new Date().toISOString();
                      const sid = slugify(r.topic);
                      await store.save({ ...(r.st ?? { schemaVersion: SCHEMA_VERSION, kind: 'skill-state', id: sid, createdAt: t, updatedAt: t, deletedAt: null, provenance: [], skill: r.topic, testedOut: false, notes: '' }), confidence: e.target.value === '' ? null : Number(e.target.value) } as SkillState);
                    }}
                  >
                    <option value="">—</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
                  </select>
                </td>
                <td>{r.st?.testedOut ? <Badge tone="ok">yes</Badge> : '—'}</td>
                <td className="small">{r.ev.map((e) => <div key={e.id}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> <Badge>{e.type}</Badge> <Badge tone={e.context === 'professional' ? 'info' : undefined}>{e.context}</Badge></div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card title="Weak topics" sub="From lapses and low recent grades in your own reviews.">
          {weak.length ? weak.slice(0, 8).map((w) => <div key={w.topic} className="small"><a href={href('learning', 'questions')}>{w.topic}</a>: {w.lapses} lapses, {w.lowGrades} low recent grades across {w.items.length} item(s)</div>) : <p className="small muted">No weak topics yet: review some cards first.</p>}
        </Card>
        <Card title="Add evidence" sub="Learning exercises stay labeled as learning; they are never promoted to professional experience.">
          <div className="grid grid-2">
            <Field label="Title"><input value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} /></Field>
            <Field label="URL"><input type="url" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} /></Field>
            <Field label="Type"><select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value as Evidence['type'] })}>{['commit', 'test', 'writeup', 'demo', 'repo', 'certificate', 'other'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Topic"><select value={ev.skill} onChange={(e) => setEv({ ...ev, skill: e.target.value })}>{topics.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Context"><select value={ev.context} onChange={(e) => setEv({ ...ev, context: e.target.value as Evidence['context'] })}><option value="learning">learning exercise</option><option value="personal_project">personal project</option><option value="professional">professional (only if real work)</option></select></Field>
          </div>
          <button
            className="btn btn-sm btn-primary"
            style={{ marginTop: '0.5rem' }}
            disabled={!ev.title || !/^https?:\/\//.test(ev.url)}
            onClick={async () => {
              const t = new Date().toISOString();
              await store.save({ schemaVersion: SCHEMA_VERSION, kind: 'evidence', id: newId('ev'), createdAt: t, updatedAt: t, deletedAt: null, provenance: [{ source: 'user', at: t }], skills: [ev.skill], type: ev.type, url: ev.url, title: ev.title, context: ev.context, note: '' } satisfies Evidence);
              setEv({ ...ev, title: '', url: '' });
              toast('Evidence added');
            }}
          >
            Add evidence
          </button>
          <p className="tiny muted" style={{ marginTop: '0.5rem' }}>Courses with your completion link: {courses.filter((c) => c.completionEvidenceUrl).length}</p>
        </Card>
      </div>
    </>
  );
}

function NotesTab({ id }: { id?: string }) {
  const cur = lessons.find((l) => l.id === id) ?? lessons[0];
  if (!cur) return <Empty title="No study notes bundled" />;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 260px) 1fr' }}>
      <nav aria-label="Study notes" className="stack">{lessons.map((l) => <a key={l.id} className={`btn btn-sm ${l.id === cur.id ? 'btn-primary' : ''}`} href={href('learning', 'notes', l.id)} style={{ justifyContent: 'flex-start' }}>{l.title}</a>)}</nav>
      <Card title={cur.title}><Markdown text={cur.text.replace(/^#\s+.+$/m, '')} /></Card>
    </div>
  );
}

export type { Profile };
