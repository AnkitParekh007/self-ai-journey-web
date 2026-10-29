// Versioned, validated data contracts. Every persisted record carries:
//   schemaVersion, id (stable), kind, createdAt, updatedAt, deletedAt (tombstone), provenance[]
// Objects are "loose": unknown fields survive a round trip, so data written by a newer
// version or imported from another system is never silently dropped.
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'ISO date or date-time');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const url = z.string().regex(/^https?:\/\/\S+$/i, 'http(s) URL');
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'safe id');

export const ProvenanceSchema = z
  .object({
    source: z.enum(['user', 'migration', 'discovery', 'import', 'ai-import', 'system', 'transcription']),
    at: isoDateTime,
    sourceRepo: z.string().optional(),
    sourcePath: z.string().optional(),
    sourceCommit: z.string().optional(),
    sourceKey: z.string().optional(),
    note: z.string().optional(),
  })
  .loose();
export type Provenance = z.infer<typeof ProvenanceSchema>;

const base = {
  schemaVersion: z.number().int().min(1),
  id,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable().optional(),
  provenance: z.array(ProvenanceSchema).default([]),
};

// ---------- shared value types ----------

export const EligibilityStatus = z.enum(['confirmed', 'unconfirmed', 'ruled_out', 'not_needed']);
export type EligibilityStatus = z.infer<typeof EligibilityStatus>;

export const EligibilityFact = z
  .object({
    status: EligibilityStatus.default('unconfirmed'),
    evidence: z.string().max(2000).optional(),
    sourceUrl: url.optional(),
    checkedAt: isoDateTime.optional(),
  })
  .loose();
export type EligibilityFact = z.infer<typeof EligibilityFact>;

export const Eligibility = z
  .object({
    indiaRemote: EligibilityFact.default({ status: 'unconfirmed' }),
    sponsorship: EligibilityFact.default({ status: 'unconfirmed' }),
    relocation: EligibilityFact.default({ status: 'unconfirmed' }),
  })
  .loose();
export type Eligibility = z.infer<typeof Eligibility>;

/** Salary exactly as stated. Parsed fields are optional helpers; `raw` is authoritative. */
export const Salary = z
  .object({
    status: z.enum(['stated', 'not_stated', 'third_party_estimate', 'unknown']).default('unknown'),
    raw: z.string().max(500).nullable().default(null),
    currency: z.string().max(8).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    period: z.enum(['year', 'month', 'day', 'hour']).optional(),
  })
  .loose();
export type Salary = z.infer<typeof Salary>;

export const WorkArrangement = z.enum(['onsite', 'hybrid', 'remote', 'unknown']);
export const EmploymentType = z.enum(['full_time', 'contract', 'part_time', 'freelance', 'unknown']);

export const TextSnapshot = z
  .object({
    text: z.string().max(60000),
    sha: z.string(),
    capturedAt: isoDateTime,
    sourceUrl: url.optional(),
    truncated: z.boolean().default(false),
  })
  .loose();

export const ScoreComponent = z.object({ score: z.number(), weight: z.number(), reason: z.string() }).loose();

/** Transparent heuristic relevance score. Never an ATS score or hiring probability. */
export const HeuristicScore = z
  .object({
    label: z.literal('heuristic-relevance'),
    total: z.number().min(0).max(100),
    components: z.record(z.string(), ScoreComponent),
    caps: z.array(z.string()).default([]),
    configVersion: z.string(),
  })
  .loose();
export type HeuristicScore = z.infer<typeof HeuristicScore>;

// ---------- discovered jobs ----------

export const JobOpenness = z
  .object({
    status: z.enum(['open', 'likely_closed', 'closed', 'unknown']),
    checkedAt: isoDateTime.optional(),
    evidence: z.string().optional(),
    missCount: z.number().int().min(0).default(0),
  })
  .loose();

export const JobSchema = z
  .object({
    ...base,
    kind: z.literal('job'),
    source: z.object({ kind: z.string(), board: z.string(), atsId: z.string().optional(), name: z.string().optional() }).loose(),
    canonicalUrl: url,
    urls: z.array(url).default([]),
    company: z.string().min(1),
    companyId: z.string().optional(),
    title: z.string().min(1),
    location: z.string().default(''),
    countries: z.array(z.string()).default([]),
    countryPriority: z.number().int().nullable().default(null),
    workArrangement: WorkArrangement.default('unknown'),
    employmentType: EmploymentType.default('unknown'),
    postedAt: isoDateTime.nullable().default(null),
    firstSeenAt: isoDateTime,
    lastSeenAt: isoDateTime,
    lastCheckedAt: isoDateTime,
    openness: JobOpenness,
    description: TextSnapshot.optional(),
    salary: Salary.default({ status: 'unknown', raw: null }),
    eligibility: Eligibility.prefault({}),
    germanRequired: z.boolean().nullable().default(null),
    score: HeuristicScore.optional(),
    classification: z.enum(['qualified', 'stretch', 'rejected', 'unscored']).default('unscored'),
    rejectionReasons: z.array(z.string()).default([]),
    matchedSkills: z.array(z.string()).default([]),
    missingSkills: z.array(z.string()).default([]),
    fingerprints: z.array(z.string()).default([]),
    /** User-owned triage. Workflows never write these fields, so merges stay independent. */
    triage: z
      .object({
        state: z.enum(['new', 'reviewing', 'saved', 'dismissed', 'promoted']).default('new'),
        note: z.string().max(4000).optional(),
        applicationId: z.string().optional(),
        updatedAt: isoDateTime.optional(),
      })
      .loose()
      .default({ state: 'new' }),
  })
  .loose();
export type Job = z.infer<typeof JobSchema>;

// ---------- applications ----------

/** Preserved from self-job-hunt/data/applications.csv. Substages extend these, never replace them. */
export const APPLICATION_STATUSES = [
  'lead',
  'shortlisted',
  'tailoring',
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const;
export const ApplicationStatus = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;
export const TERMINAL_STATUSES: ApplicationStatus[] = ['offer', 'rejected', 'withdrawn', 'ghosted'];

export const InterviewRound = z
  .object({
    id: z.string(),
    no: z.number().int().min(1),
    name: z.string().default(''),
    scheduledAt: isoDateTime.nullable().default(null),
    /** IANA zone the time was given in, e.g. Europe/Berlin. Displayed explicitly. */
    timezone: z.string().nullable().default(null),
    outcome: z.enum(['scheduled', 'done', 'passed', 'failed', 'cancelled', 'unknown']).default('unknown'),
    notes: z.string().max(8000).optional(),
    prepPath: z.string().optional(),
  })
  .loose();
export type InterviewRound = z.infer<typeof InterviewRound>;

export const Contact = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
    email: z.string().optional(),
    linkedin: z.string().optional(),
    /** Where the contact was published. Required: never guess contacts. */
    sourceUrl: z.string().min(1),
    addedAt: isoDateTime,
    notes: z.string().optional(),
  })
  .loose();
export type Contact = z.infer<typeof Contact>;

export const DocumentVersion = z
  .object({
    id: z.string(),
    kind: z.enum(['resume', 'cover_letter', 'answers', 'interview_prep', 'other']),
    version: z.number().int().min(1),
    path: z.string(),
    formats: z.array(z.enum(['md', 'pdf', 'docx', 'html'])).default(['md']),
    generatedAt: isoDateTime,
    generator: z.string(),
    provenancePath: z.string().optional(),
    reviewState: z.enum(['draft', 'reviewed', 'approved']).default('draft'),
    openTodos: z.number().int().min(0).default(0),
  })
  .loose();
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const ApplicationSchema = z
  .object({
    ...base,
    kind: z.literal('application'),
    legacyId: z.string().optional(),
    leadId: z.string().optional(),
    jobId: z.string().optional(),
    company: z.string().min(1),
    companyId: z.string().optional(),
    role: z.string().min(1),
    location: z.string().default(''),
    url: z.string().default(''),
    source: z.string().default(''),
    jdSnapshot: TextSnapshot.optional(),
    workArrangement: WorkArrangement.default('unknown'),
    workArrangementRaw: z.string().optional(),
    employmentType: EmploymentType.default('unknown'),
    salary: Salary.default({ status: 'unknown', raw: null }),
    eligibility: Eligibility.prefault({}),
    match: z
      .object({
        score: z.number().nullable().default(null),
        scale: z.string().default('heuristic'),
        explanation: z.string().default(''),
        matched: z.array(z.string()).default([]),
        missingEvidence: z.array(z.string()).default([]),
        gaps: z.array(z.string()).default([]),
      })
      .loose()
      .prefault({}),
    status: ApplicationStatus,
    /** Free-text stage, e.g. "Round 2: Technical peer (scheduled on 2026-11-06)". */
    stage: z.string().default(''),
    /** Optional finer-grained substage, e.g. "take-home", "references". Unknown values allowed. */
    substage: z.string().optional(),
    priority: z.number().int().min(0).max(9).nullable().default(null),
    nextAction: z.object({ text: z.string().default(''), due: isoDate.nullable().default(null) }).loose().default({ text: '', due: null }),
    deadline: isoDate.nullable().default(null),
    dates: z
      .object({ found: isoDate.nullable().default(null), applied: isoDate.nullable().default(null), lastUpdate: isoDate.nullable().default(null) })
      .loose()
      .default({ found: null, applied: null, lastUpdate: null }),
    /** Never inferred from document generation. Only events set this. */
    submission: z
      .object({
        state: z.enum(['not_submitted', 'user_reported', 'confirmed']).default('not_submitted'),
        at: isoDate.nullable().default(null),
        evidence: z.string().optional(),
      })
      .loose()
      .default({ state: 'not_submitted', at: null }),
    interviewRounds: z.array(InterviewRound).default([]),
    documents: z.array(DocumentVersion).default([]),
    contacts: z.array(Contact).default([]),
    notes: z.string().max(20000).default(''),
    rejectionFeedback: z.string().max(8000).optional(),
    prepLinks: z.array(z.string()).default([]),
    folder: z.string().optional(),
  })
  .loose();
export type Application = z.infer<typeof ApplicationSchema>;

// ---------- companies ----------

export const CompanySchema = z
  .object({
    ...base,
    kind: z.literal('company'),
    name: z.string().min(1),
    website: z.string().optional(),
    careersUrl: z.string().optional(),
    industry: z.string().optional(),
    product: z.string().optional(),
    countries: z.array(z.string()).default([]),
    researchNotes: z.string().max(20000).default(''),
    contacts: z.array(Contact).default([]),
    interviewExpectations: z
      .array(z.object({ text: z.string(), label: z.enum(['sourced', 'inferred']), sourceUrl: z.string().optional() }).loose())
      .default([]),
    ats: z.array(z.object({ kind: z.string(), board: z.string() }).loose()).default([]),
  })
  .loose();
export type Company = z.infer<typeof CompanySchema>;

// ---------- append-only events ----------

export const EVENT_TYPES = [
  'created',
  'status_changed',
  'applied',
  'screening',
  'round_scheduled',
  'round_outcome',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
  'note',
  'document_generated',
  'document_reviewed',
  'triage',
  'deleted',
  'review',
  'course_progress',
  'mock_answer',
  'quiz_attempt',
  'diagnostic',
  'evidence_added',
] as const;

export const EventSchema = z
  .object({
    id,
    type: z.enum(EVENT_TYPES),
    /** When it happened (user-reported date allowed). */
    at: isoDateTime,
    recordedAt: isoDateTime,
    subject: z.object({ kind: z.string(), id: z.string() }),
    actor: z.enum(['user', 'workflow', 'migration', 'system']),
    /** For submissions and outcomes: did we see evidence, or did the user tell us? */
    confirmation: z.enum(['confirmed', 'user_reported', 'not_applicable']).default('not_applicable'),
    data: z.record(z.string(), z.unknown()).default({}),
    note: z.string().max(8000).optional(),
    provenance: z.array(ProvenanceSchema).default([]),
  })
  .loose();
export type AppEvent = z.infer<typeof EventSchema>;

/** Immutable file: data/events/YYYY/MM/<batchId>.json. Never rewritten after commit. */
export const EventBatchSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    kind: z.literal('event-batch'),
    id,
    createdAt: isoDateTime,
    events: z.array(EventSchema).min(1),
  })
  .loose();
export type EventBatch = z.infer<typeof EventBatchSchema>;

// ---------- learning ----------

export const CourseProgressSchema = z
  .object({
    ...base,
    kind: z.literal('course-progress'),
    resourceId: z.string(),
    status: z.enum(['not_started', 'planned', 'in_progress', 'completed_self_reported', 'tested_out', 'dropped']).default('not_started'),
    plannedHours: z.number().min(0).nullable().default(null),
    spentHours: z.number().min(0).default(0),
    notes: z.string().max(40000).default(''),
    deliverableUrl: z.string().optional(),
    /** Only a link or badge the user supplies. The app never awards completion. */
    completionEvidenceUrl: z.string().optional(),
  })
  .loose();
export type CourseProgress = z.infer<typeof CourseProgressSchema>;

export const SkillStateSchema = z
  .object({
    ...base,
    kind: z.literal('skill-state'),
    skill: z.string(),
    confidence: z.number().int().min(0).max(5).nullable().default(null),
    testedOut: z.boolean().default(false),
    notes: z.string().default(''),
  })
  .loose();
export type SkillState = z.infer<typeof SkillStateSchema>;

export const EvidenceSchema = z
  .object({
    ...base,
    kind: z.literal('evidence'),
    skills: z.array(z.string()).min(1),
    type: z.enum(['commit', 'test', 'writeup', 'demo', 'repo', 'certificate', 'other']),
    url: z.string(),
    title: z.string(),
    /** Learning artefacts are never professional experience. */
    context: z.enum(['learning', 'personal_project', 'professional']).default('learning'),
    note: z.string().default(''),
  })
  .loose();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const MockAnswerSchema = z
  .object({
    ...base,
    kind: z.literal('mock-answer'),
    questionId: z.string(),
    mode: z.enum(['typed', 'recorded-elsewhere', 'spoken-notes']),
    answer: z.string().max(40000),
    durationSec: z.number().int().min(0).nullable().default(null),
    selfScores: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
    aiFeedback: z
      .object({ importedAt: isoDateTime, model: z.string().optional(), summary: z.string(), scores: z.record(z.string(), z.number()).default({}) })
      .loose()
      .optional(),
  })
  .loose();
export type MockAnswer = z.infer<typeof MockAnswerSchema>;

export const LearningSettingsSchema = z
  .object({
    ...base,
    kind: z.literal('learning-settings'),
    dailyMinutes: z.number().int().min(15).max(720).default(120),
    startDate: isoDate.nullable().default(null),
    interviewDates: z.array(z.object({ date: isoDate, applicationId: z.string().optional(), label: z.string() }).loose()).default([]),
    plan: z.enum(['sprint-30', 'roadmap-90']).default('sprint-30'),
    displayTimezone: z.string().default('Asia/Kolkata'),
  })
  .loose();
export type LearningSettings = z.infer<typeof LearningSettingsSchema>;

// ---------- profile ----------

export const ClaimStatus = z.enum(['verified', 'user_confirmed', 'draft', 'todo']);
export const DeploymentStatus = z.enum(['production', 'enterprise_pilot', 'prototype', 'personal_project', 'learning_exercise', 'unknown']);

export const EvidenceItem = z
  .object({
    id: z.string(),
    text: z.string(),
    status: ClaimStatus,
    tags: z.array(z.string()).default([]),
    deploymentStatus: DeploymentStatus.optional(),
    source: z.string().optional(),
  })
  .loose();
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const ProfileSchema = z
  .object({
    ...base,
    kind: z.literal('profile'),
    name: z.string(),
    headline: z.string().default(''),
    location: z.string().default(''),
    links: z.array(z.object({ label: z.string(), url: z.string() }).loose()).default([]),
    /** Kept out of every public build and never rendered except on the user's own documents. */
    privateContact: z.object({ email: z.string().optional(), phone: z.string().optional() }).loose().default({}),
    availability: z.string().default(''),
    languages: z.array(z.string()).default([]),
    rules: z
      .object({
        noTotalYears: z.boolean().default(true),
        experiencePhrases: z.array(z.string()).default([]),
        formExperienceYears: z.number().int().nullable().default(null),
        doNotClaim: z.array(z.string()).default([]),
        twoPageCvAllowedFor: z.array(z.string()).default([]),
        coverLetterParagraphs: z.number().int().default(3),
      })
      .loose(),
    roles: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            org: z.string(),
            location: z.string().default(''),
            start: z.string(),
            end: z.string(),
            employment: z.string().default(''),
            summary: z.string().default(''),
            highlights: z.array(EvidenceItem).default([]),
            stack: z.array(z.string()).default([]),
          })
          .loose(),
      )
      .default([]),
    projects: z
      .array(
        z
          .object({ id: z.string(), name: z.string(), deploymentStatus: DeploymentStatus, statusText: z.string(), claims: z.array(EvidenceItem).default([]) })
          .loose(),
      )
      .default([]),
    skills: z.array(z.object({ name: z.string(), evidenceIds: z.array(z.string()).default([]), status: ClaimStatus }).loose()).default([]),
    achievements: z.array(EvidenceItem).default([]),
    stories: z.array(EvidenceItem).default([]),
    todos: z.array(z.string()).default([]),
    sourceFile: z.string().optional(),
    sourceSha: z.string().optional(),
  })
  .loose();
export type Profile = z.infer<typeof ProfileSchema>;

// ---------- discovery bookkeeping (workflow-owned) ----------

export const DiscoveryRunSchema = z
  .object({
    schemaVersion: z.number().int(),
    kind: z.literal('discovery-run'),
    id,
    startedAt: isoDateTime,
    finishedAt: isoDateTime,
    trigger: z.enum(['schedule', 'manual', 'local', 'fixture']),
    outcome: z.enum(['success', 'partial', 'failed']),
    target: z.object({ min: z.number(), max: z.number() }),
    counts: z.record(z.string(), z.number()),
    sources: z.array(
      z.object({ id: z.string(), ok: z.boolean(), fetched: z.number(), error: z.string().optional(), ms: z.number(), cached: z.boolean().default(false) }).loose(),
    ),
    shortfall: z.number(),
    limitations: z.array(z.string()).default([]),
  })
  .loose();
export type DiscoveryRun = z.infer<typeof DiscoveryRunSchema>;

// ---------- registry ----------

export const RECORD_SCHEMAS = {
  job: JobSchema,
  application: ApplicationSchema,
  company: CompanySchema,
  'event-batch': EventBatchSchema,
  'course-progress': CourseProgressSchema,
  'skill-state': SkillStateSchema,
  evidence: EvidenceSchema,
  'mock-answer': MockAnswerSchema,
  'learning-settings': LearningSettingsSchema,
  profile: ProfileSchema,
  'discovery-run': DiscoveryRunSchema,
} as const;
export type RecordKind = keyof typeof RECORD_SCHEMAS;

export function validateRecord(data: unknown): { ok: true; kind: RecordKind; value: unknown } | { ok: false; error: string } {
  const kind = (data as { kind?: string } | null)?.kind as RecordKind | undefined;
  if (!kind || !(kind in RECORD_SCHEMAS)) return { ok: false, error: `unknown record kind: ${String(kind)}` };
  const r = RECORD_SCHEMAS[kind].safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  return { ok: true, kind, value: r.data };
}
