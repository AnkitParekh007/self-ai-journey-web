// Schemas for bundled learning content (original questions, course catalog, plans).
// This content is non-personal and is the only data allowed into the public shell.
import { z } from 'zod';

export const TRACKS = ['frontend-fullstack', 'applied-ai'] as const;

export const QuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    track: z.enum(TRACKS),
    topic: z.string(),
    difficulty: z.enum(['foundation', 'intermediate', 'senior', 'staff']),
    roles: z.array(z.string()).min(1),
    format: z.enum(['subjective', 'objective']),
    question: z.string().min(10),
    intent: z.string().min(10),
    spokenAnswer: z.string().min(40),
    deepDive: z.string().min(60),
    example: z.string().min(20),
    tradeoffs: z.array(z.string()).min(1),
    mistakes: z.array(z.string()).min(1),
    followUps: z.array(z.string()).min(1),
    rubric: z.array(z.object({ criterion: z.string(), strong: z.string() })).min(2),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).default([]),
    // objective questions only
    choices: z.array(z.string()).optional(),
    answerIndex: z.number().int().optional(),
    tags: z.array(z.string()).default([]),
  })
  .superRefine((q, ctx) => {
    if (q.format === 'objective') {
      if (!q.choices || q.choices.length < 3 || q.answerIndex === undefined || q.answerIndex >= q.choices.length) {
        ctx.addIssue({ code: 'custom', message: `${q.id}: objective questions need >=3 choices and a valid answerIndex` });
      }
    }
  });
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionBankSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  track: z.enum(TRACKS),
  description: z.string(),
  questions: z.array(QuestionSchema).min(1),
});
export type QuestionBank = z.infer<typeof QuestionBankSchema>;

export const CourseResourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  provider: z.string(),
  url: z.string().url(),
  kind: z.enum(['course', 'docs', 'guide', 'spec', 'repo', 'article']),
  topics: z.array(z.string()).min(1),
  track: z.enum(TRACKS),
  prerequisites: z.array(z.string()).default([]),
  cost: z.object({
    access: z.enum(['free', 'free-with-account', 'paid', 'unknown']),
    apiUsageNeeded: z.enum(['none', 'optional', 'required', 'unknown']),
    certification: z.enum(['none', 'free-certificate', 'paid-exam', 'unknown']),
    note: z.string().default(''),
  }),
  /** Stated by the provider. null = not verified; never guessed. */
  statedDuration: z.string().nullable(),
  plannedHours: z.number().min(0),
  verification: z.object({
    status: z.enum(['verified', 'search-index-only', 'unverified', 'broken']),
    checkedAt: z.string().nullable(),
    method: z.string(),
  }),
  deliverable: z.string(),
  competencies: z.array(z.string()).min(1),
  priority: z.number().int().min(1).max(5),
});
export type CourseResource = z.infer<typeof CourseResourceSchema>;

export const CatalogSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  notes: z.array(z.string()),
  resources: z.array(CourseResourceSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const PlanDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  track: z.enum([...TRACKS, 'both']),
  topics: z.array(z.string()),
  blocks: z.array(z.object({ minutes: z.number().int().min(5), kind: z.enum(['study', 'practice', 'build', 'review', 'mock', 'diagnostic']), task: z.string(), resourceIds: z.array(z.string()).default([]) })),
  deliverable: z.string(),
});
export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.enum(['sprint-30', 'roadmap-90']),
  title: z.string(),
  baselineMinutesPerDay: z.number().int(),
  days: z.array(PlanDaySchema),
});
export type Plan = z.infer<typeof PlanSchema>;
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const DiagnosticSchema = z.object({
  schemaVersion: z.literal(1),
  topics: z.array(z.object({ topic: z.string(), track: z.enum(TRACKS), probeQuestionIds: z.array(z.string()).min(1), testOutRule: z.string() })),
});
