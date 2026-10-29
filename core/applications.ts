// Application lifecycle. Mirrors self-job-hunt/scripts/track.py semantics (follow-up intervals,
// stage wording, round handling) but writes append-only events plus the updated projection in
// the same commit. Document generation NEVER changes status; only explicit user events do.
import { newId } from './ids';
import {
  SCHEMA_VERSION,
  TERMINAL_STATUSES,
  type AppEvent,
  type Application,
  type ApplicationStatus,
  type EventBatch,
  type InterviewRound,
} from './schemas';

export const FOLLOW_UP_DAYS: Partial<Record<string, number>> = { applied: 7, screening: 3, round: 2, offer: 2 };

export type StatusInput =
  | { type: 'applied'; date: string; confirmation: 'confirmed' | 'user_reported'; note?: string }
  | { type: 'screening'; date: string; note?: string }
  | { type: 'round'; date: string; no: number; name?: string; scheduledAt?: string | null; timezone?: string | null; outcome: InterviewRound['outcome']; note?: string }
  | { type: 'offer' | 'rejected' | 'withdrawn' | 'ghosted'; date: string; note?: string; feedback?: string }
  | { type: 'status'; date: string; status: ApplicationStatus; substage?: string; note?: string }
  | { type: 'note'; date: string; note: string };

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Transition {
  application: Application;
  events: AppEvent[];
}

export function applyStatusChange(app: Application, input: StatusInput, nowIso = new Date().toISOString()): Transition {
  const a: Application = structuredClone(app);
  const day = input.date.slice(0, 10);
  const prevStatus = a.status;
  const events: AppEvent[] = [];
  const ev = (type: AppEvent['type'], data: Record<string, unknown>, confirmation: AppEvent['confirmation'] = 'not_applicable'): AppEvent => ({
    id: newId('evt'),
    type,
    at: day,
    recordedAt: nowIso,
    subject: { kind: 'application', id: a.id },
    actor: 'user',
    confirmation,
    data,
    note: 'note' in input ? input.note : undefined,
    provenance: [],
  });

  a.dates = { ...a.dates, lastUpdate: day };
  switch (input.type) {
    case 'applied': {
      a.status = 'applied';
      a.dates.applied = a.dates.applied ?? day;
      a.stage = 'Applied, awaiting reply';
      a.submission = { state: input.confirmation, at: day, evidence: input.note };
      a.nextAction = { text: 'Follow up with recruiter if no reply', due: plusDays(day, FOLLOW_UP_DAYS.applied!) };
      events.push(ev('applied', { from: prevStatus, to: 'applied' }, input.confirmation));
      break;
    }
    case 'screening': {
      a.status = 'screening';
      a.stage = 'Recruiter screen';
      a.nextAction = { text: 'Reply and book the screen', due: plusDays(day, FOLLOW_UP_DAYS.screening!) };
      events.push(ev('screening', { from: prevStatus, to: 'screening' }));
      break;
    }
    case 'round': {
      a.status = 'interview';
      const rid = `round-${input.no}`;
      const existing = a.interviewRounds.find((r) => r.id === rid);
      const round: InterviewRound = {
        id: rid,
        no: input.no,
        name: input.name ?? existing?.name ?? '',
        scheduledAt: input.scheduledAt ?? existing?.scheduledAt ?? null,
        timezone: input.timezone ?? existing?.timezone ?? null,
        outcome: input.outcome,
        notes: existing?.notes,
        prepPath: existing?.prepPath,
      };
      a.interviewRounds = [...a.interviewRounds.filter((r) => r.id !== rid), round].sort((x, y) => x.no - y.no);
      const label = `Round ${round.no}${round.name ? `: ${round.name}` : ''}`;
      if (round.outcome === 'scheduled') {
        a.stage = `${label} (scheduled${round.scheduledAt ? ` on ${round.scheduledAt.slice(0, 10)}` : ''})`;
        a.nextAction = { text: `Prepare for ${label}`, due: round.scheduledAt ? plusDays(round.scheduledAt, -1) : plusDays(day, 1) };
        events.push(ev('round_scheduled', { round }));
      } else if (round.outcome === 'failed') {
        a.status = 'rejected';
        a.stage = `Rejected after ${label}`;
        a.nextAction = { text: '', due: null };
        events.push(ev('round_outcome', { round, from: prevStatus, to: 'rejected' }));
      } else {
        a.stage = `${label} (${round.outcome})`;
        a.nextAction = { text: 'Wait for next round; follow up if silent', due: plusDays(day, FOLLOW_UP_DAYS.round!) };
        events.push(ev('round_outcome', { round }));
      }
      break;
    }
    case 'offer':
    case 'rejected':
    case 'withdrawn':
    case 'ghosted': {
      const reached = prevStatus === 'applied' || a.stage.startsWith('Applied') ? 'at application screen' : a.stage || 'application';
      a.status = input.type;
      a.stage = {
        offer: 'Offer received',
        rejected: `Rejected (${reached})`,
        withdrawn: `Withdrawn (${reached})`,
        ghosted: `No reply (${reached})`,
      }[input.type];
      a.nextAction = input.type === 'offer' ? { text: 'Review and negotiate the offer', due: plusDays(day, 2) } : { text: '', due: null };
      if (input.type === 'rejected' && input.feedback) a.rejectionFeedback = input.feedback;
      events.push(ev(input.type, { from: prevStatus, to: input.type, feedback: 'feedback' in input ? input.feedback : undefined }));
      break;
    }
    case 'status': {
      if (input.status === 'applied') throw new Error('use type "applied" with an explicit confirmation to mark an application as submitted');
      a.status = input.status;
      if (input.substage !== undefined) a.substage = input.substage || undefined;
      events.push(ev('status_changed', { from: prevStatus, to: input.status, substage: input.substage }));
      break;
    }
    case 'note': {
      events.push(ev('note', {}));
      break;
    }
  }
  a.updatedAt = nowIso;
  return { application: a, events };
}

export function makeBatch(events: AppEvent[], nowIso = new Date().toISOString()): EventBatch {
  return { schemaVersion: SCHEMA_VERSION, kind: 'event-batch', id: newId('batch'), createdAt: nowIso, events };
}

export interface FollowUp {
  applicationId: string;
  company: string;
  role: string;
  reason: string;
  due: string | null;
  overdue: boolean;
}

/** Same rule as self-job-hunt `followups`: due next actions, plus in-process apps silent for 21+ days. */
export function followUps(apps: Application[], today: string): FollowUp[] {
  const out: FollowUp[] = [];
  for (const a of apps) {
    if (a.deletedAt) continue;
    if (a.nextAction?.due && a.nextAction.text && a.nextAction.due <= today && !TERMINAL_STATUSES.includes(a.status)) {
      out.push({ applicationId: a.id, company: a.company, role: a.role, reason: a.nextAction.text, due: a.nextAction.due, overdue: a.nextAction.due < today });
      continue;
    }
    const last = a.dates?.lastUpdate;
    if (last && ['applied', 'screening', 'interview'].includes(a.status) && plusDays(last, 21) <= today) {
      out.push({ applicationId: a.id, company: a.company, role: a.role, reason: 'No update for 21+ days: draft a follow-up or mark ghosted', due: plusDays(last, 21), overdue: true });
    }
  }
  return out.sort((x, y) => (x.due ?? '').localeCompare(y.due ?? ''));
}

export function upcomingRounds(apps: Application[], fromIso: string, days = 14) {
  const end = plusDays(fromIso, days);
  const res: Array<{ application: Application; round: InterviewRound }> = [];
  for (const a of apps) {
    if (a.deletedAt) continue;
    for (const r of a.interviewRounds) {
      if (r.outcome === 'scheduled' && r.scheduledAt && r.scheduledAt.slice(0, 10) >= fromIso.slice(0, 10) && r.scheduledAt.slice(0, 10) <= end) {
        res.push({ application: a, round: r });
      }
    }
  }
  return res.sort((x, y) => (x.round.scheduledAt ?? '').localeCompare(y.round.scheduledAt ?? ''));
}

/** Format an instant in an explicit IANA time zone, always printing the zone name. */
export function formatInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${s} (${timeZone})`;
}
