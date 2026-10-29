// Deterministic learning planner: today's blocks from the chosen plan, scaled to the user's
// daily capacity, reprioritized when an interview is near, skipping topics tested out.
import type { Plan, PlanDay } from './content';
import type { Application, LearningSettings } from './schemas';
import { daysBetween } from './discovery';

export interface TodayBlock {
  minutes: number;
  kind: PlanDay['blocks'][number]['kind'] | 'interview-prep';
  task: string;
  resourceIds: string[];
  reason?: string;
}

export interface TodayPlan {
  dayNumber: number;
  totalDays: number;
  focus: string;
  topics: string[];
  deliverable: string;
  blocks: TodayBlock[];
  minutes: number;
  notes: string[];
}

export function planForToday(plan: Plan, settings: Pick<LearningSettings, 'dailyMinutes' | 'startDate' | 'interviewDates'>, today: string, opts: { testedOut?: string[]; upcomingApps?: Application[] } = {}): TodayPlan {
  const start = settings.startDate ?? today;
  const idx = Math.min(plan.days.length - 1, Math.max(0, daysBetween(start, today)));
  const d = plan.days[idx];
  const notes: string[] = [];
  const tested = new Set((opts.testedOut ?? []).map((t) => t.toLowerCase()));
  let blocks: TodayBlock[] = d.blocks.map((b) => ({ ...b }));
  if (d.topics.length && d.topics.every((t) => tested.has(t.toLowerCase()))) {
    blocks = blocks.map((b) => (b.kind === 'study' ? { ...b, kind: 'review', task: `Tested out of ${d.topics.join(', ')}: spaced review and one stretch question instead of first-time study.` } : b));
    notes.push('Topics tested out; study time converted to review.');
  }

  // Interview within 7 days: front-load preparation for it.
  const soon = settings.interviewDates
    .map((i) => ({ ...i, inDays: daysBetween(today, i.date) }))
    .filter((i) => i.inDays >= 0 && i.inDays <= 7)
    .sort((a, b) => a.inDays - b.inDays)[0];
  if (soon) {
    const prepMinutes = Math.round(settings.dailyMinutes * (soon.inDays <= 2 ? 0.6 : 0.35));
    blocks.unshift({ minutes: prepMinutes, kind: 'interview-prep', task: `Interview prep: ${soon.label} (${soon.inDays === 0 ? 'today' : `in ${soon.inDays} day(s)`}). Company pack, STAR stories from verified profile facts, one timed mock answer.`, resourceIds: [], reason: 'interview date' });
    notes.push(`Reprioritized for ${soon.label}.`);
  }

  // Scale to capacity: keep order (most important first), shrink proportionally, drop overflow.
  const budget = settings.dailyMinutes;
  const planned = blocks.reduce((s, b) => s + b.minutes, 0);
  if (planned > budget) {
    const factor = budget / planned;
    let used = 0;
    blocks = blocks
      .map((b) => ({ ...b, minutes: Math.max(10, Math.round((b.minutes * factor) / 5) * 5) }))
      .filter((b) => {
        if (used + b.minutes > budget + 5) return false;
        used += b.minutes;
        return true;
      });
    notes.push(`Scaled from ${planned} to ${budget} minutes.`);
  } else if (planned < budget) {
    blocks.push({ minutes: budget - planned, kind: 'review', task: 'Spaced review queue, then weakest topic practice.', resourceIds: [] });
  }
  return { dayNumber: idx + 1, totalDays: plan.days.length, focus: d.focus, topics: d.topics, deliverable: d.deliverable, blocks, minutes: blocks.reduce((s, b) => s + b.minutes, 0), notes };
}

/** Diagnostic: a topic counts as tested out only with ≥3 probe answers self-rated ≥2/3 and no 0s. */
export function diagnosticResult(probeScores: Record<string, number[]>): { testedOut: string[]; focus: string[] } {
  const testedOut: string[] = [];
  const focus: string[] = [];
  for (const [topic, scores] of Object.entries(probeScores)) {
    if (scores.length >= 3 && scores.every((s) => s >= 2)) testedOut.push(topic);
    else if (scores.some((s) => s === 0) || scores.length === 0) focus.push(topic);
  }
  return { testedOut, focus };
}

/** Learning consistency: distinct active days in the last N days from event timestamps. */
export function consistency(eventDays: string[], today: string, window = 30): { activeDays: number; window: number; streak: number } {
  const set = new Set(eventDays.map((d) => d.slice(0, 10)));
  let active = 0;
  for (let i = 0; i < window; i++) {
    const d = new Date(Date.parse(today) - i * 86_400_000).toISOString().slice(0, 10);
    if (set.has(d)) active++;
  }
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(Date.parse(today) - i * 86_400_000).toISOString().slice(0, 10);
    if (!set.has(d)) break;
    streak++;
  }
  return { activeDays: active, window, streak };
}
