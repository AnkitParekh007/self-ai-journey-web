// One record per file. Paths are derived from kind + id so every writer agrees.
import type { RecordKind } from './schemas';

export const DATA_PREFIXES = ['data/'];

/** Paths the browser may write. Workflow-owned bookkeeping is read-only in the app. */
export const BROWSER_WRITABLE = [
  /^data\/jobs\/[^/]+\.json$/,
  /^data\/applications\/[^/]+\.json$/,
  /^data\/companies\/[^/]+\.json$/,
  /^data\/events\/\d{4}\/\d{2}\/[^/]+\.json$/,
  /^data\/learning\/(courses|skills|evidence|mock-answers)\/[^/]+\.json$/,
  /^data\/learning\/settings\.json$/,
];

export function isBrowserWritable(path: string): boolean {
  return BROWSER_WRITABLE.some((re) => re.test(path));
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function recordPath(kind: RecordKind, id: string, at?: string): string {
  if (!SAFE.test(id)) throw new Error(`unsafe id for path: ${id}`);
  switch (kind) {
    case 'job':
      return `data/jobs/${id}.json`;
    case 'application':
      return `data/applications/${id}.json`;
    case 'company':
      return `data/companies/${id}.json`;
    case 'event-batch': {
      const d = (at ?? new Date().toISOString()).slice(0, 7).split('-');
      return `data/events/${d[0]}/${d[1]}/${id}.json`;
    }
    case 'course-progress':
      return `data/learning/courses/${id}.json`;
    case 'skill-state':
      return `data/learning/skills/${id}.json`;
    case 'evidence':
      return `data/learning/evidence/${id}.json`;
    case 'mock-answer':
      return `data/learning/mock-answers/${id}.json`;
    case 'learning-settings':
      return `data/learning/settings.json`;
    case 'profile':
      return `data/profile/profile.json`;
    case 'discovery-run':
      return `data/discovery/runs/${id}.json`;
  }
}

export function isEventBatchPath(path: string): boolean {
  return /^data\/events\/\d{4}\/\d{2}\/[^/]+\.json$/.test(path);
}
