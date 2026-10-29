import { foldReviews } from '@core/srs';
import { SCHEMA_VERSION, type DiscoveryRun, type LearningSettings, type Profile } from '@core/schemas';
import { newId } from '@core/ids';
import type { AppStore } from './store';
import { todayIso } from '../lib/dates';

export function learningSettings(store: AppStore): LearningSettings {
  const s = store.record<LearningSettings>('learning-settings', 'settings');
  if (s) return s;
  const t = new Date().toISOString();
  return { schemaVersion: SCHEMA_VERSION, kind: 'learning-settings', id: 'settings', createdAt: t, updatedAt: t, deletedAt: null, provenance: [], dailyMinutes: 120, startDate: null, interviewDates: [], plan: 'sprint-30', displayTimezone: 'Asia/Kolkata' };
}

export function reviewStates(store: AppStore) {
  return foldReviews(store.events(), todayIso());
}

export function raw<T>(store: AppStore, path: string): T | undefined {
  return store.allEntries().find((e) => e.path === path)?.data as T | undefined;
}

export interface AutomationStatus {
  lastAttemptAt?: string;
  lastAttemptTrigger?: string;
  lastOutcome?: 'success' | 'partial' | 'failed';
  lastSuccessAt?: string | null;
  lastPartialAt?: string | null;
  lastSuccessfulManualRunAt?: string | null;
  consecutiveFailures?: number;
}

export const automationStatus = (store: AppStore) => raw<AutomationStatus>(store, 'data/discovery/automation-status.json');
export const sourceHealth = (store: AppStore) =>
  raw<{ sources: Record<string, { lastAttemptAt: string; lastSuccessAt: string | null; consecutiveFailures: number; lastError: string | null; lastCount: number }> }>(store, 'data/discovery/source-health.json');
export const discoveryRuns = (store: AppStore) => store.records<DiscoveryRun>('discovery-run').sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
export const profile = (store: AppStore) => store.record<Profile>('profile', 'profile');

/** Scheduled runs are best-effort: flag as stale when no attempt in the last 30 hours. */
export function scheduleHealth(st: AutomationStatus | undefined): { state: 'never' | 'ok' | 'stale' | 'failing' | 'partial'; text: string } {
  if (!st?.lastAttemptAt) return { state: 'never', text: 'No discovery run has been synced yet.' };
  const hours = (Date.now() - Date.parse(st.lastAttemptAt)) / 3_600_000;
  if (hours > 30) return { state: 'stale', text: `Last attempt ${Math.round(hours)} h ago: the daily run looks missed.` };
  if (st.lastOutcome === 'failed') return { state: 'failing', text: `Last run failed (${st.consecutiveFailures ?? 1} in a row).` };
  if (st.lastOutcome === 'partial') return { state: 'partial', text: 'Last run was partial: some sources failed.' };
  return { state: 'ok', text: 'Last run completed.' };
}

export function reviewEvent(itemId: string, grade: number, extra: Record<string, unknown> = {}) {
  const t = new Date().toISOString();
  return { id: newId('evt'), type: 'review' as const, at: t, recordedAt: t, subject: { kind: 'question', id: itemId }, actor: 'user' as const, confirmation: 'not_applicable' as const, data: { itemId, grade, ...extra }, provenance: [] };
}
