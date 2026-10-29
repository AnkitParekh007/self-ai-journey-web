// Pure discovery logic: normalization, deduplication, eligibility evidence, transparent scoring,
// and merging a run into the persistent job set. No network or filesystem access here, so the
// whole pipeline is testable with fixtures.
import { stableId } from './ids';
import { sha1 } from './sha1';
import { SCHEMA_VERSION, type EligibilityFact, type HeuristicScore, type Job, type Salary } from './schemas';

export interface RawPosting {
  sourceId: string; // e.g. greenhouse:gitlab
  sourceKind: string;
  board: string;
  company: string;
  atsId?: string;
  title: string;
  location: string;
  url: string;
  postedAt?: string | null;
  body: string;
  remoteFlag?: boolean;
  visaFlag?: boolean;
  salaryText?: string | null;
  employmentType?: string | null;
}

export interface DiscoveryConfig {
  target: { min: number; max: number };
  countries: Array<{ name: string; priority: number; pattern: string }>;
  remoteIndia: { priority: number; confirmPattern: string; worldwidePattern: string; regionLockPattern: string; indiaOnsite: 'stretch' | 'reject' };
  roles: {
    families: Array<{ id: string; label: string; fit: number; pattern: string }>;
    seniority: { strong: string; medium: string; junior: string; midLevel?: string };
    titleRequired: string;
    titleRoleNoun?: string;
    titleExclude: string;
  };
  language: { germanRequiredPattern: string; englishOkPattern: string; otherLanguageRequiredPattern?: string };
  eligibility: { sponsorshipConfirmPattern: string; sponsorshipRuleOutPattern: string };
  freshness: { maxAgeDays: number; staleWithoutPostedDateAfterDays: number };
  limits: { maxDescriptionChars: number } & Record<string, number>;
  closure: { missesBeforeClosed: number };
}

export interface ScoringConfig {
  version: string;
  weights: Record<'roleFit' | 'skillFit' | 'seniority' | 'location' | 'eligibility' | 'compensation' | 'freshness', number>;
  thresholds: { qualified: number; stretch: number };
  caps: Record<string, { max: number; why: string }>;
  skills: { strong: string[]; medium: string[]; mismatchSignals: string[] };
  compensation: { minAnnualEUR: number; fxToEUR: Record<string, number> };
}

const re = (p: string) => new RegExp(p, 'i');

// ---------- URLs and fingerprints ----------

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = new URLSearchParams();
    const gh = u.searchParams.get('gh_jid');
    if (gh) keep.set('gh_jid', gh);
    u.search = keep.toString() ? `?${keep}` : '';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/** Greenhouse job IDs are globally unique, whichever host or company page serves them. */
export function greenhouseId(url: string): string | null {
  const m = url.match(/[?&]gh_jid=(\d+)/) ?? url.match(/greenhouse\.io\/[^/]+\/jobs\/(\d+)/);
  return m ? m[1] : null;
}

export function normCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(gmbh|inc|ltd|limited|llc|se|ag|plc|bv|co|kg|corp|corporation|labs?)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((m|w|f|d|x|all genders?|gn)[/|,]?.*?\)/g, ' ')
    .replace(/\b(m\/w\/d|w\/m\/d|f\/m\/d|m\/f\/d|all genders)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normCity(location: string): string {
  return (location.split(/[,;/|·-]/)[0] ?? '').toLowerCase().replace(/[^a-z]+/g, '');
}

export function fingerprints(p: { url: string; sourceKind?: string; board?: string; atsId?: string; company: string; title: string; location: string }): string[] {
  const fps = new Set<string>();
  fps.add(`url:${canonicalUrl(p.url)}`);
  const gh = greenhouseId(p.url);
  if (gh) fps.add(`gh:${gh}`);
  if (p.atsId && p.sourceKind && p.board) fps.add(`ats:${p.sourceKind.replace(/-eu$/, '')}:${p.board.toLowerCase()}:${p.atsId}`);
  fps.add(`cr:${normCompany(p.company)}|${normTitle(p.title)}|${normCity(p.location)}`);
  return [...fps];
}

export function primaryFingerprint(fps: string[]): string {
  return fps.find((f) => f.startsWith('gh:')) ?? fps.find((f) => f.startsWith('ats:')) ?? fps.find((f) => f.startsWith('url:')) ?? fps[0];
}

export function jobIdFor(fps: string[]): string {
  return stableId('job', primaryFingerprint(fps));
}

// ---------- classification ----------

export interface LocationResult {
  countries: string[];
  priority: number | null;
  remote: boolean;
  indiaRemote: EligibilityFact;
  indiaOnsite: boolean;
}

export function classifyLocation(cfg: DiscoveryConfig, p: Pick<RawPosting, 'location' | 'title' | 'body' | 'remoteFlag'>): LocationResult {
  const where = `${p.location} ${p.title}`;
  const countries = cfg.countries.filter((c) => re(c.pattern).test(where)).sort((a, b) => a.priority - b.priority);
  const remote = !!p.remoteFlag || /\bremote\b|work from home|distributed|anywhere/i.test(where);
  const locIndia = re(cfg.remoteIndia.confirmPattern).test(p.location);
  const bodyHead = p.body.slice(0, 6000);
  let indiaRemote: EligibilityFact = { status: 'unconfirmed' };
  if (remote && locIndia) indiaRemote = { status: 'confirmed', evidence: `Location lists: "${p.location.slice(0, 120)}"` };
  else if (remote && re(cfg.remoteIndia.regionLockPattern).test(`${p.location} ${bodyHead}`)) {
    const m = `${p.location} ${bodyHead}`.match(re(cfg.remoteIndia.regionLockPattern));
    indiaRemote = { status: 'ruled_out', evidence: `Remote is region-locked: "${m?.[0].slice(0, 120)}"` };
  } else if (remote && re(cfg.remoteIndia.worldwidePattern).test(where)) {
    indiaRemote = { status: 'unconfirmed', evidence: 'Says remote/worldwide but does not name India; verify hiring entities and payroll countries.' };
  } else if (!remote && countries.length) indiaRemote = { status: 'ruled_out', evidence: `On-site/hybrid in ${countries.map((c) => c.name).join(', ')}` };
  const indiaOnsite = !remote && locIndia;
  let priority: number | null = countries[0]?.priority ?? null;
  if (priority === null && remote && indiaRemote.status !== 'ruled_out' && (locIndia || re(cfg.remoteIndia.worldwidePattern).test(where))) priority = cfg.remoteIndia.priority;
  return { countries: countries.map((c) => c.name), priority, remote, indiaRemote, indiaOnsite };
}

export function detectSponsorship(cfg: DiscoveryConfig, p: Pick<RawPosting, 'body' | 'visaFlag'>): EligibilityFact {
  const ruleOut = p.body.match(re(cfg.eligibility.sponsorshipRuleOutPattern));
  if (ruleOut) return { status: 'ruled_out', evidence: snippet(p.body, ruleOut.index ?? 0) };
  const conf = p.body.match(re(cfg.eligibility.sponsorshipConfirmPattern));
  if (conf) return { status: 'confirmed', evidence: snippet(p.body, conf.index ?? 0) };
  if (p.visaFlag) return { status: 'confirmed', evidence: 'Listed in a visa-sponsorship feed (source flag); confirm on the posting.' };
  return { status: 'unconfirmed' };
}

function snippet(text: string, at: number): string {
  return `"…${text.slice(Math.max(0, at - 60), at + 140).replace(/\s+/g, ' ').trim()}…"`;
}

export function parseSalary(text: string | null | undefined): Salary {
  if (!text) return { status: 'not_stated', raw: null };
  const m = text.match(/(€|EUR|\$|USD|£|GBP|AED|SGD|S\$|MYR|RM|INR|₹|CHF)\s?([\d.,]+)\s*(k|K)?\s*(?:-|–|to)\s*(€|EUR|\$|USD|£|GBP|AED|SGD|S\$|MYR|RM|INR|₹|CHF)?\s?([\d.,]+)\s*(k|K)?(?:\s*(?:per|\/|a)\s*(year|annum|yr|month|mo|hour|hr|day))?/);
  if (!m) return { status: 'not_stated', raw: null };
  const cur = ({ '€': 'EUR', $: 'USD', '£': 'GBP', 'S$': 'SGD', RM: 'MYR', '₹': 'INR' } as Record<string, string>)[m[1]] ?? m[1];
  const num = (s: string, k?: string) => parseFloat(s.replace(/,/g, '')) * (k ? 1000 : 1);
  const period = m[7] ? (/^(year|annum|yr)/.test(m[7]) ? 'year' : /^mo/.test(m[7]) ? 'month' : /^h/.test(m[7]) ? 'hour' : 'day') : undefined;
  return { status: 'stated', raw: m[0].trim(), currency: cur, min: num(m[2], m[3]), max: num(m[5], m[6] ?? m[3]), period };
}

// ---------- scoring ----------

export interface Evaluation {
  candidate: RawPosting;
  fingerprints: string[];
  location: LocationResult;
  sponsorship: EligibilityFact;
  germanRequired: boolean;
  salary: Salary;
  score: HeuristicScore | null;
  classification: 'qualified' | 'stretch' | 'rejected';
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
}

export function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function evaluate(cfg: DiscoveryConfig, sc: ScoringConfig, p: RawPosting, nowIso: string): Evaluation {
  const reasons: string[] = [];
  const fps = fingerprints({ url: p.url, sourceKind: p.sourceKind, board: p.board, atsId: p.atsId, company: p.company, title: p.title, location: p.location });
  const loc = classifyLocation(cfg, p);
  const sponsorship = detectSponsorship(cfg, p);
  const germanRequired = re(cfg.language.germanRequiredPattern).test(p.body) && !re(cfg.language.englishOkPattern).test(p.body);
  const salary = parseSalary(p.salaryText ?? p.body.slice(0, 20000));
  const base = { candidate: p, fingerprints: fps, location: loc, sponsorship, germanRequired, salary, matchedSkills: [] as string[], missingSkills: [] as string[] };

  // Hard filters (explainable rejections)
  if (!re(cfg.roles.titleRequired).test(p.title)) reasons.push('title outside target role families');
  else if (cfg.roles.titleRoleNoun && !re(cfg.roles.titleRoleNoun).test(p.title)) reasons.push('title outside target role families (no engineering/architecture role in title)');
  if (re(cfg.roles.titleExclude).test(p.title)) reasons.push(`excluded role type ("${p.title.match(re(cfg.roles.titleExclude))?.[0]}")`);
  if (re(cfg.roles.seniority.junior).test(p.title)) reasons.push('junior/intern level');
  if (loc.priority === null) {
    if (loc.indiaOnsite && cfg.remoteIndia.indiaOnsite === 'stretch') {
      /* handled as stretch below */
    } else if (loc.remote && loc.indiaRemote.status === 'ruled_out') reasons.push(`remote but not open to India: ${loc.indiaRemote.evidence}`);
    else reasons.push(`location not in target countries ("${p.location.slice(0, 80) || 'unknown'}")`);
  }
  if (germanRequired) reasons.push('fluent German required');
  const otherLang = cfg.language.otherLanguageRequiredPattern ? `${p.title}\n${p.body.slice(0, 8000)}`.match(re(cfg.language.otherLanguageRequiredPattern)) : null;
  if (otherLang) reasons.push(`language requirement ("${otherLang[0]}")`);
  const ageDays = p.postedAt ? daysBetween(p.postedAt, nowIso) : null;
  if (ageDays !== null && ageDays > cfg.freshness.maxAgeDays) reasons.push(`stale: posted ${ageDays} days ago`);
  const clearlyIneligible = sponsorship.status === 'ruled_out' && loc.indiaRemote.status !== 'confirmed' && !loc.indiaOnsite;
  if (clearlyIneligible) reasons.push(`clearly ineligible: ${sponsorship.evidence}`);
  if (reasons.length) return { ...base, score: null, classification: 'rejected', reasons };

  // Components (each 0..1, explained)
  const text = `${p.title}\n${p.body}`.toLowerCase();
  const fam = cfg.roles.families.filter((f) => re(f.pattern).test(p.title)).sort((a, b) => b.fit - a.fit);
  const roleFit = fam[0]?.fit ?? 0.3;
  const strong = sc.skills.strong.filter((s) => text.includes(s));
  const medium = sc.skills.medium.filter((s) => text.includes(s));
  const mismatch = sc.skills.mismatchSignals.filter((s) => re(s).test(p.body));
  const skillFit = Math.min(1, (strong.length * 1 + medium.length * 0.4) / 6) * (mismatch.length >= 2 ? 0.6 : mismatch.length ? 0.85 : 1);
  const midLevel = cfg.roles.seniority.midLevel ? re(cfg.roles.seniority.midLevel).test(p.title.trim()) : false;
  const seniority = re(cfg.roles.seniority.strong).test(p.title) ? 1 : midLevel ? 0.35 : re(cfg.roles.seniority.medium).test(p.title) ? 0.6 : 0.25;
  const pr = loc.priority;
  const location = pr === null ? 0.3 : ({ 1: 1, 2: 0.9, 3: 0.8, 4: 0.7, 5: 0.65, 6: 0.85 } as Record<number, number>)[pr] ?? 0.5;
  const eligibilityScore =
    loc.indiaRemote.status === 'confirmed' || sponsorship.status === 'confirmed' ? 1 : sponsorship.status === 'ruled_out' ? 0.1 : loc.indiaOnsite ? 0.6 : 0.4;
  let compensation = 0.5;
  let compReason = 'not stated (unknown, neutral)';
  if (salary.status === 'stated' && salary.currency && salary.max) {
    const fx = sc.compensation.fxToEUR[salary.currency];
    const mult = salary.period === 'month' ? 12 : salary.period === 'hour' ? 1700 : salary.period === 'day' ? 220 : 1;
    if (fx) {
      const eur = salary.max * mult * fx;
      compensation = eur >= sc.compensation.minAnnualEUR ? 1 : 0.25;
      compReason = `stated ${salary.raw} ≈ EUR ${Math.round(eur / 1000)}k/yr max (approx. FX) ${eur >= sc.compensation.minAnnualEUR ? 'meets' : 'below'} target`;
    }
  }
  const freshness = ageDays === null ? 0.5 : ageDays <= 7 ? 1 : ageDays <= 14 ? 0.75 : 0.45;
  const w = sc.weights;
  const comps: HeuristicScore['components'] = {
    roleFit: { score: roleFit, weight: w.roleFit, reason: fam[0] ? `title matches ${fam[0].label}` : 'no strong role family match' },
    skillFit: {
      score: round2(skillFit),
      weight: w.skillFit,
      reason: `matched: ${[...strong, ...medium].slice(0, 10).join(', ') || 'none'}${mismatch.length ? `; mismatch signals: ${mismatch.length}` : ''}`,
    },
    seniority: { score: seniority, weight: w.seniority, reason: seniority === 1 ? 'staff/principal/lead/architect level' : seniority > 0.5 ? 'senior level' : 'seniority not stated' },
    location: { score: location, weight: w.location, reason: pr === null ? (loc.indiaOnsite ? 'India on-site (outside priority list; stretch)' : 'location unclear') : pr === 6 ? 'remote, India-compatible signals' : `${loc.countries[0]} (priority ${pr})` },
    eligibility: {
      score: eligibilityScore,
      weight: w.eligibility,
      reason: `India-remote ${loc.indiaRemote.status}; sponsorship/relocation ${sponsorship.status}`,
    },
    compensation: { score: compensation, weight: w.compensation, reason: compReason },
    freshness: { score: freshness, weight: w.freshness, reason: ageDays === null ? 'posted date unknown' : `posted ${ageDays} day(s) ago` },
  };
  let total = Object.values(comps).reduce((s, c) => s + c.score * c.weight, 0);
  const caps: string[] = [];
  const needsSponsor = loc.indiaRemote.status !== 'confirmed' && !loc.indiaOnsite;
  if (needsSponsor && sponsorship.status !== 'confirmed' && total > sc.caps.sponsorshipUnstated.max) {
    total = sc.caps.sponsorshipUnstated.max;
    caps.push(sc.caps.sponsorshipUnstated.why);
  }
  if (mismatch.length >= 2 && total > sc.caps.roleFamilyMismatch.max) {
    total = sc.caps.roleFamilyMismatch.max;
    caps.push(sc.caps.roleFamilyMismatch.why);
  }
  total = Math.round(total);
  const score: HeuristicScore = { label: 'heuristic-relevance', total, components: comps, caps, configVersion: sc.version };
  let classification: Evaluation['classification'] = total >= sc.thresholds.qualified ? 'qualified' : total >= sc.thresholds.stretch ? 'stretch' : 'rejected';
  // Qualified needs a target seniority: strong title level, or "senior" with strong role fit.
  if (classification === 'qualified' && !(seniority === 1 || (seniority >= 0.6 && roleFit >= 0.85))) {
    classification = 'stretch';
    caps.push('Seniority not stated or below the Staff/Principal/Lead/Architect target: at most stretch.');
  }
  if (loc.indiaOnsite) {
    if (seniority === 1 && roleFit >= 0.8 && classification !== 'rejected') classification = 'stretch';
    else if (classification !== 'rejected') {
      classification = 'rejected';
      reasons.push('India on-site role outside the priority list without strong seniority and role fit');
    }
  }
  if (classification === 'rejected' && !reasons.length) reasons.push(`low relevance score ${total} < ${sc.thresholds.stretch}`);
  return { ...base, score, classification, reasons, matchedSkills: [...strong, ...medium], missingSkills: mismatch };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- merging a run into persistent state ----------

export interface SourceResult {
  id: string;
  ok: boolean;
  fetched: number;
  error?: string;
  ms: number;
  cached?: boolean;
  postings: RawPosting[];
}

export interface RejectedEntry {
  reason: string;
  firstSeen: string;
  lastSeen: string;
  title: string;
  company: string;
  url: string;
}

export interface RunPlan {
  writes: Job[];
  newQualified: Job[];
  newStretch: Job[];
  updated: Job[];
  newlyRejected: Array<{ title: string; company: string; url: string; reasons: string[] }>;
  repeatRejected: number;
  knownElsewhere: Array<{ title: string; company: string; url: string }>;
  closedOrLikely: Job[];
  duplicatesInRun: number;
  rejectedIndex: Record<string, RejectedEntry>;
  countryCounts: Record<string, number>;
  rejectionReasonCounts: Record<string, number>;
}

export function planRun(args: {
  cfg: DiscoveryConfig;
  sc: ScoringConfig;
  now: string;
  existing: Job[];
  sources: SourceResult[];
  knownUrls: Set<string>; // fingerprints known from applications / legacy systems
  rejectedIndex: Record<string, RejectedEntry>;
}): RunPlan {
  const { cfg, sc, now, existing, sources } = args;
  const byFp = new Map<string, Job>();
  for (const j of existing) for (const f of j.fingerprints) byFp.set(f, j);
  const plan: RunPlan = {
    writes: [],
    newQualified: [],
    newStretch: [],
    updated: [],
    newlyRejected: [],
    repeatRejected: 0,
    knownElsewhere: [],
    closedOrLikely: [],
    duplicatesInRun: 0,
    rejectedIndex: { ...args.rejectedIndex },
    countryCounts: {},
    rejectionReasonCounts: {},
  };
  const seenInRun = new Set<string>();
  const touched = new Map<string, Job>();
  const seenJobIds = new Set<string>();

  for (const src of sources) {
    if (!src.ok) continue;
    for (const p of src.postings) {
      const ev = evaluate(cfg, sc, p, now);
      if (ev.fingerprints.some((f) => seenInRun.has(f))) {
        plan.duplicatesInRun++;
        // Prefer the employer's own board over aggregators for the same role.
        continue;
      }
      ev.fingerprints.forEach((f) => seenInRun.add(f));
      const prev = ev.fingerprints.map((f) => byFp.get(f)).find(Boolean);
      if (prev) {
        seenJobIds.add(prev.id);
        const j = updateExisting(prev, ev, now, cfg);
        touched.set(j.id, j);
        plan.updated.push(j);
        continue;
      }
      if (ev.classification === 'rejected') {
        const key = primaryFingerprint(ev.fingerprints);
        const r = plan.rejectedIndex[key];
        const reason = ev.reasons[0];
        plan.rejectionReasonCounts[reason.replace(/\(.*$|:.*$/, '').trim()] = (plan.rejectionReasonCounts[reason.replace(/\(.*$|:.*$/, '').trim()] ?? 0) + 1;
        if (r) {
          plan.repeatRejected++;
          plan.rejectedIndex[key] = { ...r, lastSeen: now };
        } else {
          plan.rejectedIndex[key] = { reason, firstSeen: now, lastSeen: now, title: p.title, company: p.company, url: p.url };
          plan.newlyRejected.push({ title: p.title, company: p.company, url: p.url, reasons: ev.reasons });
        }
        continue;
      }
      const j = newJob(ev, now, cfg);
      if (ev.fingerprints.some((f) => args.knownUrls.has(f))) {
        (j as Job & { knownElsewhere?: boolean }).knownElsewhere = true;
        plan.knownElsewhere.push({ title: j.title, company: j.company, url: j.canonicalUrl });
      } else if (ev.classification === 'qualified') plan.newQualified.push(j);
      else plan.newStretch.push(j);
      touched.set(j.id, j);
      for (const c of j.countries.length ? j.countries : [j.countryPriority === 6 ? 'Remote (India-compatible)' : 'Other']) {
        if (ev.classification === 'qualified') plan.countryCounts[c] = (plan.countryCounts[c] ?? 0) + 1;
      }
    }
  }

  // Openness: only judge jobs whose source was fetched successfully in this run.
  const okSources = new Set(sources.filter((s) => s.ok).map((s) => s.id));
  for (const j of existing) {
    if (seenJobIds.has(j.id) || j.deletedAt) continue;
    const sid = `${j.source.kind}:${j.source.board}`;
    if (!okSources.has(sid)) continue; // fetch failed or not attempted → unknown, leave as is
    if (j.openness.status === 'closed') continue;
    const miss = (j.openness.missCount ?? 0) + 1;
    const status = miss >= cfg.closure.missesBeforeClosed ? 'closed' : 'likely_closed';
    const nj: Job = {
      ...j,
      updatedAt: now,
      lastCheckedAt: now,
      openness: { status, checkedAt: now, missCount: miss, evidence: `Not listed on ${sid} board in ${miss} successful fetch(es)` },
    };
    touched.set(nj.id, nj);
    plan.closedOrLikely.push(nj);
  }
  // Prune rejected index entries not seen for 45 days.
  for (const [k, v] of Object.entries(plan.rejectedIndex)) if (daysBetween(v.lastSeen, now) > 45) delete plan.rejectedIndex[k];
  plan.writes = [...touched.values()];
  plan.newQualified.sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0) || (a.countryPriority ?? 9) - (b.countryPriority ?? 9));
  plan.newStretch.sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
  return plan;
}

function descriptionSnapshot(p: RawPosting, now: string, max: number) {
  const text = p.body.slice(0, max);
  return { text, sha: sha1(p.body), capturedAt: now, sourceUrl: p.url.startsWith('http') ? p.url : undefined, truncated: p.body.length > max };
}

function workArrangement(loc: LocationResult, p: RawPosting): Job['workArrangement'] {
  if (/hybrid/i.test(`${p.location} ${p.title}`)) return 'hybrid';
  if (loc.remote) return 'remote';
  if (/on-?site|office/i.test(p.location)) return 'onsite';
  return 'unknown';
}

function newJob(ev: Evaluation, now: string, cfg: DiscoveryConfig): Job {
  const p = ev.candidate;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'job',
    id: jobIdFor(ev.fingerprints),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    provenance: [{ source: 'discovery', at: now, sourceKey: p.sourceId }],
    source: { kind: p.sourceKind, board: p.board, atsId: p.atsId, name: p.company },
    canonicalUrl: canonicalUrl(p.url),
    urls: [p.url],
    company: p.company,
    title: p.title,
    location: p.location,
    countries: ev.location.countries,
    countryPriority: ev.location.priority,
    workArrangement: workArrangement(ev.location, p),
    employmentType: /contract|freelance/i.test(`${p.title} ${p.employmentType ?? ''}`) ? 'contract' : /full.?time|permanent/i.test(p.employmentType ?? '') ? 'full_time' : 'unknown',
    postedAt: p.postedAt ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastCheckedAt: now,
    openness: { status: 'open', checkedAt: now, missCount: 0, evidence: `Listed on ${p.sourceId} at fetch time (board listing, posting page not opened)` },
    description: descriptionSnapshot(p, now, cfg.limits.maxDescriptionChars),
    salary: ev.salary,
    eligibility: { indiaRemote: ev.location.indiaRemote, sponsorship: ev.sponsorship, relocation: ev.sponsorship.status === 'confirmed' ? ev.sponsorship : { status: 'unconfirmed' } },
    germanRequired: ev.germanRequired,
    score: ev.score ?? undefined,
    classification: ev.classification,
    rejectionReasons: ev.reasons,
    matchedSkills: ev.matchedSkills,
    missingSkills: ev.missingSkills,
    fingerprints: ev.fingerprints,
    triage: { state: 'new' },
  };
}

/** Refresh discovery-owned fields only. `triage` (user-owned) is never touched here. */
function updateExisting(prev: Job, ev: Evaluation, now: string, cfg: DiscoveryConfig): Job {
  const p = ev.candidate;
  const descChanged = prev.description?.sha !== sha1(p.body);
  return {
    ...prev,
    updatedAt: now,
    lastSeenAt: now,
    lastCheckedAt: now,
    urls: [...new Set([...prev.urls, p.url])],
    fingerprints: [...new Set([...prev.fingerprints, ...ev.fingerprints])],
    postedAt: prev.postedAt ?? p.postedAt ?? null,
    openness: { status: 'open', checkedAt: now, missCount: 0, evidence: `Listed on ${p.sourceId} at fetch time` },
    description: descChanged ? descriptionSnapshot(p, now, cfg.limits.maxDescriptionChars) : prev.description,
    score: ev.score ?? prev.score,
    classification: ev.classification === 'rejected' && prev.classification !== 'rejected' ? prev.classification : ev.classification,
    eligibility: prev.eligibility.sponsorship.status === 'unconfirmed' ? { ...prev.eligibility, sponsorship: ev.sponsorship } : prev.eligibility,
  };
}
