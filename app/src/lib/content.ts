// Bundled, non-personal learning content. Only these globs are compiled into the app, so the
// public shell can never pick up data/, applications/ or content/interview-prep/.
import { CatalogSchema, PlanSchema, QuestionBankSchema, DiagnosticSchema, type Catalog, type Plan, type Question, type QuestionBank } from '@core/content';

const bankFiles = import.meta.glob('../../../content/question-banks/*.json', { eager: true, import: 'default' });
const catalogFile = import.meta.glob('../../../content/courses/catalog.json', { eager: true, import: 'default' });
const planFiles = import.meta.glob('../../../content/courses/plans/*.json', { eager: true, import: 'default' });
const diagFile = import.meta.glob('../../../content/courses/diagnostic.json', { eager: true, import: 'default' });
const lessonFiles = import.meta.glob('../../../content/lessons/*.md', { eager: true, query: '?raw', import: 'default' });
const projectFiles = import.meta.glob('../../../content/projects/*/*.md', { eager: true, query: '?raw', import: 'default' });

export const banks: QuestionBank[] = Object.values(bankFiles).map((b) => QuestionBankSchema.parse(b));
export const questions: Question[] = banks.flatMap((b) => b.questions);
export const questionById = new Map(questions.map((q) => [q.id, q]));
export const catalog: Catalog = CatalogSchema.parse(Object.values(catalogFile)[0] ?? { schemaVersion: 1, updatedAt: '', notes: [], resources: [] });
export const plans: Plan[] = Object.values(planFiles).map((p) => PlanSchema.parse(p));
export const diagnostic = DiagnosticSchema.parse(Object.values(diagFile)[0] ?? { schemaVersion: 1, topics: [] });

export const lessons = Object.entries(lessonFiles)
  .map(([p, text]) => ({ id: p.split('/').pop()!.replace(/\.md$/, ''), text: text as string, title: ((text as string).match(/^#\s+(.+)$/m)?.[1] ?? p) }))
  .sort((a, b) => a.id.localeCompare(b.id));

export const projects = Object.entries(projectFiles).reduce<Record<string, Array<{ file: string; text: string }>>>((acc, [p, text]) => {
  const parts = p.split('/');
  const id = parts[parts.length - 2];
  (acc[id] ??= []).push({ file: parts[parts.length - 1], text: text as string });
  return acc;
}, {});

export const topics = [...new Set(questions.map((q) => q.topic))].sort();
