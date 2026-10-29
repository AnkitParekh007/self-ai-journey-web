import { useMemo } from 'react';
import { followUps, upcomingRounds, formatInZone } from '@core/applications';
import { planForToday } from '@core/learning';
import { dueItems } from '@core/srs';
import type { Application, Job } from '@core/schemas';
import { Badge, Card, Empty, PageHead, eligLabel, eligTone, useRecords, useStore } from '../ui/components';
import { href } from '../lib/router';
import { relDays, todayIso, ago } from '../lib/dates';
import { learningSettings, reviewStates, automationStatus, scheduleHealth } from '../state/selectors';
import { plans, questions } from '../lib/content';

export function TodayPage() {
  const store = useStore();
  const jobs = useRecords<Job>('job');
  const apps = useRecords<Application>('application');
  const today = todayIso();
  const settings = learningSettings(store);
  const tz = settings.displayTimezone;

  const toReview = useMemo(
    () =>
      jobs
        .filter((j) => ['qualified', 'stretch'].includes(j.classification) && ['new', 'reviewing'].includes(j.triage.state) && j.openness.status !== 'closed')
        .sort((a, b) => Number(b.classification === 'qualified') - Number(a.classification === 'qualified') || (b.score?.total ?? 0) - (a.score?.total ?? 0) || (a.countryPriority ?? 9) - (b.countryPriority ?? 9))
        .slice(0, 8),
    [jobs],
  );
  const fu = followUps(apps, today);
  const deadlines = apps.filter((a) => a.deadline && a.deadline >= today && a.deadline <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const rounds = upcomingRounds(apps, today, 14);
  const plan = plans.find((p) => p.id === settings.plan) ?? plans[0];
  const states = reviewStates(store);
  const due = dueItems(questions.map((q) => q.id), states, today, 50);
  const newCards = questions.filter((q) => !states.has(q.id)).length;
  const tp = plan ? planForToday(plan, settings, today) : null;
  const auto = scheduleHealth(automationStatus(store));
  const empty = jobs.length === 0 && apps.length === 0;

  return (
    <>
      <PageHead
        title="Today"
        sub={new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) + ` · times shown in ${tz}`}
      />
      {empty && (
        <div className="callout">
          <strong>Your working copy is empty.</strong> Connect your private repository or import an export in <a href={href('settings')}>Data &amp; sync</a>. Learning content works right away.
        </div>
      )}
      {auto.state !== 'ok' && auto.state !== 'never' && <div className="callout callout-warn small">Discovery: {auto.text} <a href={href('jobs')}>Details</a></div>}
      <div className="grid grid-2">
        <Card title="Jobs to review" sub="Highest heuristic relevance first (not a hiring probability).">
          {toReview.length ? (
            <ul className="list">
              {toReview.map((j) => (
                <li key={j.id}>
                  <span className="score" title="Heuristic relevance 0–100">{j.score?.total ?? '–'}</span>
                  <div className="grow">
                    <a className="title" href={href('jobs', j.id)}>{j.title}</a> {j.classification === 'stretch' && <Badge tone="warn" title={j.score?.caps.join(' ')}>stretch</Badge>}
                    <div className="small muted">{j.company} · {j.location || 'location unknown'}</div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <Badge tone={eligTone(j.eligibility.sponsorship.status)}>visa: {eligLabel(j.eligibility.sponsorship.status)}</Badge>
                      <Badge tone={eligTone(j.eligibility.indiaRemote.status)}>India-remote: {eligLabel(j.eligibility.indiaRemote.status)}</Badge>
                    </div>
                    <div className="next-action">Next: open, check eligibility, then save or dismiss</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing waiting">New qualified jobs appear here after a discovery run is synced.</Empty>
          )}
        </Card>

        <Card title="Follow-ups & deadlines">
          {fu.length || deadlines.length ? (
            <ul className="list">
              {fu.map((f) => (
                <li key={f.applicationId + f.reason}>
                  <Badge tone={f.overdue ? 'bad' : 'warn'}>{f.overdue ? 'overdue' : 'due'}</Badge>
                  <div className="grow">
                    <a className="title" href={href('applications', f.applicationId)}>{f.company} — {f.role}</a>
                    <div className="next-action">Next: {f.reason} {f.due && <span className="muted">({relDays(f.due, today)})</span>}</div>
                  </div>
                </li>
              ))}
              {deadlines.map((a) => (
                <li key={`dl-${a.id}`}>
                  <Badge tone="warn">deadline</Badge>
                  <div className="grow">
                    <a className="title" href={href('applications', a.id)}>{a.company} — {a.role}</a>
                    <div className="next-action">Next: finish and submit yourself before {a.deadline} ({relDays(a.deadline, today)})</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No follow-ups due" />
          )}
        </Card>

        <Card title="Upcoming interviews" sub="Shown in your display time zone and in the zone the interviewer gave.">
          {rounds.length ? (
            <ul className="list">
              {rounds.map(({ application: a, round: r }) => (
                <li key={a.id + r.id}>
                  <div className="grow">
                    <a className="title" href={href('applications', a.id)}>{a.company} — Round {r.no}{r.name ? `: ${r.name}` : ''}</a>
                    <div className="small">{formatInZone(r.scheduledAt!, tz)}</div>
                    {r.timezone && r.timezone !== tz && <div className="small muted">{formatInZone(r.scheduledAt!, r.timezone)}</div>}
                    <div className="next-action">Next: <a href={href('learning', 'interview', a.id)}>open the prep pack</a></div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No interviews scheduled in the next 14 days" />
          )}
        </Card>

        <Card title="Today's learning" sub={tp ? `${plan.title} · day ${tp.dayNumber}/${tp.totalDays} · ${tp.minutes} min` : undefined}>
          {tp ? (
            <>
              <p><strong>{tp.focus}</strong></p>
              <ul className="list">
                {tp.blocks.map((b, i) => (
                  <li key={i}>
                    <Badge tone="accent">{b.minutes}m</Badge>
                    <div className="grow small">
                      <strong>{b.kind}</strong> — {b.task}
                    </div>
                  </li>
                ))}
              </ul>
              {tp.notes.length > 0 && <p className="tiny muted">{tp.notes.join(' ')}</p>}
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <a className="btn btn-primary btn-sm" href={href('learning', 'flashcards')}>Review {due.length} due card(s)</a>
                <span className="small muted">{newCards} not yet seen</span>
                <a className="btn btn-sm" href={href('learning', 'plan')}>Open plan</a>
              </div>
            </>
          ) : (
            <Empty title="No plan loaded" />
          )}
        </Card>
      </div>
      <p className="tiny muted" style={{ marginTop: '1rem' }}>Last sync {ago(store.status().lastSyncAt)}. This app never submits applications or contacts anyone.</p>
    </>
  );
}
