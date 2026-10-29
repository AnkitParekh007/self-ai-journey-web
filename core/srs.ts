// SM-2 style spaced repetition. Review state is never stored directly: it is folded from
// append-only `review` events, so two devices reviewing the same deck merge cleanly.
import { plusDays } from './applications';
import type { AppEvent } from './schemas';

export type Grade = 0 | 1 | 2 | 3 | 4 | 5; // 0-2 = forgot, 3 = hard, 4 = good, 5 = easy

export interface ReviewState {
  itemId: string;
  reps: number;
  interval: number; // days
  ease: number;
  due: string; // YYYY-MM-DD
  lastReviewed: string | null;
  lapses: number;
  lastGrade: Grade | null;
  history: Array<{ at: string; grade: Grade }>;
}

export function initialState(itemId: string, today: string): ReviewState {
  return { itemId, reps: 0, interval: 0, ease: 2.5, due: today, lastReviewed: null, lapses: 0, lastGrade: null, history: [] };
}

export function review(s: ReviewState, grade: Grade, day: string): ReviewState {
  const next = { ...s, history: [...s.history, { at: day, grade }], lastReviewed: day, lastGrade: grade };
  if (grade < 3) {
    next.reps = 0;
    next.interval = 1;
    next.lapses = s.lapses + 1;
  } else {
    next.reps = s.reps + 1;
    next.interval = next.reps === 1 ? 1 : next.reps === 2 ? 3 : Math.round(s.interval * s.ease);
    if (grade === 3) next.interval = Math.max(1, Math.round(next.interval * 0.8));
  }
  next.ease = Math.max(1.3, s.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  next.due = plusDays(day, next.interval);
  return next;
}

export function foldReviews(events: AppEvent[], today: string): Map<string, ReviewState> {
  const states = new Map<string, ReviewState>();
  const reviews = events
    .filter((e) => e.type === 'review' && typeof e.data.itemId === 'string')
    .sort((a, b) => (a.at + a.recordedAt).localeCompare(b.at + b.recordedAt) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const e of reviews) {
    if (seen.has(e.id)) continue; // idempotent if a batch is imported twice
    seen.add(e.id);
    const itemId = e.data.itemId as string;
    const g = Number(e.data.grade);
    if (!Number.isInteger(g) || g < 0 || g > 5) continue;
    const s = states.get(itemId) ?? initialState(itemId, today);
    states.set(itemId, review(s, g as Grade, e.at.slice(0, 10)));
  }
  return states;
}

export function dueItems(itemIds: string[], states: Map<string, ReviewState>, today: string, limit = 30) {
  const due = itemIds
    .map((id) => states.get(id))
    .filter((s): s is ReviewState => !!s && s.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due) || a.ease - b.ease);
  return due.slice(0, limit);
}

/** Weak topics: items with lapses or low recent grades, grouped by topic. Evidence-based, no invented %. */
export function weakTopics(items: Array<{ id: string; topic: string }>, states: Map<string, ReviewState>) {
  const byTopic = new Map<string, { topic: string; reviewed: number; lapses: number; lowGrades: number; items: string[] }>();
  for (const it of items) {
    const s = states.get(it.id);
    if (!s || s.history.length === 0) continue;
    const t = byTopic.get(it.topic) ?? { topic: it.topic, reviewed: 0, lapses: 0, lowGrades: 0, items: [] };
    t.reviewed++;
    t.lapses += s.lapses;
    const recent = s.history.slice(-3);
    const low = recent.filter((h) => h.grade < 3).length;
    t.lowGrades += low;
    if (s.lapses > 0 || low > 0) t.items.push(it.id);
    byTopic.set(it.topic, t);
  }
  return [...byTopic.values()].filter((t) => t.items.length > 0).sort((a, b) => b.lapses + b.lowGrades - (a.lapses + a.lowGrades));
}
