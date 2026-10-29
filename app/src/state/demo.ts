// Synthetic demo data. Every company is fictional and labeled "(demo)".
import { SCHEMA_VERSION, type Application, type Job } from '@core/schemas';
import { recordPath } from '@core/paths';
import type { AppStore } from './store';

const now = () => new Date().toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function demoJob(i: number, title: string, company: string, location: string, country: string, priority: number, score: number, extra: Partial<Job> = {}): Job {
  const t = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'job',
    id: `job-demo-${i}`,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    provenance: [{ source: 'system', at: t, note: 'synthetic demo data' }],
    source: { kind: 'demo', board: 'demo', name: company },
    canonicalUrl: `https://example.com/demo/jobs/${i}`,
    urls: [],
    company,
    title,
    location,
    countries: [country],
    countryPriority: priority,
    workArrangement: 'hybrid',
    employmentType: 'full_time',
    postedAt: day(-2),
    firstSeenAt: t,
    lastSeenAt: t,
    lastCheckedAt: t,
    openness: { status: 'open', missCount: 0, checkedAt: t, evidence: 'demo' },
    description: { text: `DEMO POSTING. ${company} builds an enterprise SaaS product. You will own frontend architecture in Angular and TypeScript, ship LLM agent features with RAG and evaluations, and mentor engineers. We offer visa sponsorship and relocation support.`, sha: 'demo', capturedAt: t, truncated: false },
    salary: { status: 'stated', raw: 'EUR 95,000 - 125,000 per year', currency: 'EUR', min: 95000, max: 125000, period: 'year' },
    eligibility: { indiaRemote: { status: 'ruled_out', evidence: 'hybrid in office country' }, sponsorship: { status: 'confirmed', evidence: '"We offer visa sponsorship and relocation support."' }, relocation: { status: 'confirmed' } },
    germanRequired: false,
    score: {
      label: 'heuristic-relevance',
      total: score,
      configVersion: 'demo',
      caps: [],
      components: {
        roleFit: { score: 1, weight: 25, reason: 'title matches Frontend / UI architecture' },
        skillFit: { score: 0.8, weight: 20, reason: 'matched: angular, typescript, llm, rag' },
        seniority: { score: 1, weight: 15, reason: 'staff/principal level' },
        location: { score: 1, weight: 15, reason: `${country} (priority ${priority})` },
        eligibility: { score: 1, weight: 15, reason: 'sponsorship confirmed' },
        compensation: { score: 1, weight: 5, reason: 'stated, meets target' },
        freshness: { score: 1, weight: 5, reason: 'posted 2 days ago' },
      },
    },
    classification: score >= 62 ? 'qualified' : 'stretch',
    rejectionReasons: [],
    matchedSkills: ['angular', 'typescript', 'llm', 'rag', 'mentoring'],
    missingSkills: [],
    fingerprints: [`demo:${i}`],
    triage: { state: 'new' },
    ...extra,
  };
}

export async function loadDemoData(store: AppStore) {
  const jobs = [
    demoJob(1, 'Staff Frontend Architect', 'Northwind Analytics (demo)', 'Berlin, Germany', 'Germany', 1, 92),
    demoJob(2, 'Principal Engineer, AI Applications', 'Contoso Cloud (demo)', 'Dublin, Ireland', 'Ireland', 2, 86),
    demoJob(3, 'AI Solutions Architect', 'Fabrikam Labs (demo)', 'Dubai, UAE', 'UAE', 3, 74),
    demoJob(4, 'Senior Angular Engineer', 'Tailspin Toys (demo)', 'Kuala Lumpur, Malaysia', 'Malaysia', 4, 55, { classification: 'stretch' }),
  ];
  for (const j of jobs) await store.save(j);
  const t = now();
  const app: Application = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'application',
    id: 'APP-DEMO-1',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    provenance: [{ source: 'system', at: t, note: 'synthetic demo data' }],
    jobId: 'job-demo-1',
    company: 'Northwind Analytics (demo)',
    role: 'Staff Frontend Architect',
    location: 'Berlin, Germany',
    url: 'https://example.com/demo/jobs/1',
    source: 'demo',
    workArrangement: 'hybrid',
    employmentType: 'full_time',
    salary: { status: 'stated', raw: 'EUR 95,000 - 125,000 per year' },
    eligibility: { indiaRemote: { status: 'ruled_out' }, sponsorship: { status: 'confirmed', evidence: 'demo' }, relocation: { status: 'confirmed' } },
    match: { score: null, scale: 'heuristic', explanation: '', matched: [], missingEvidence: [], gaps: [] },
    status: 'interview',
    stage: 'Round 1: Recruiter screen (scheduled)',
    priority: 1,
    nextAction: { text: 'Prepare for Round 1', due: day(1) },
    deadline: null,
    dates: { found: day(-5), applied: day(-4), lastUpdate: day(-1) },
    submission: { state: 'confirmed', at: day(-4), evidence: 'demo confirmation' },
    interviewRounds: [{ id: 'round-1', no: 1, name: 'Recruiter screen', scheduledAt: `${day(2)}T09:30:00+01:00`, timezone: 'Europe/Berlin', outcome: 'scheduled' }],
    documents: [],
    contacts: [],
    notes: 'Synthetic demo application.',
    prepLinks: [],
  };
  await store.save(app);
  void recordPath;
}
