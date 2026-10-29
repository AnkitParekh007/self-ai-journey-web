import { useMemo, useState } from 'react';
import { SCHEMA_VERSION, type Application, type Company, type Job } from '@core/schemas';
import { newId, slugify } from '@core/ids';
import { Badge, Card, Empty, Field, Markdown, PageHead, useRecords, useStore, useToast } from '../ui/components';
import { href, navigate } from '../lib/router';
import { todayIso } from '../lib/dates';

export function CompaniesPage({ id }: { id?: string }) {
  return id ? <CompanyDetail id={id} /> : <CompanyList />;
}

function CompanyList() {
  const store = useStore();
  const companies = useRecords<Company>('company');
  const apps = useRecords<Application>('application');
  const jobs = useRecords<Job>('job');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const counts = useMemo(() => {
    const m = new Map<string, { apps: number; jobs: number }>();
    const key = (s: string) => slugify(s.replace(/\(.*?\)/g, ''));
    for (const a of apps) m.set(key(a.company), { apps: (m.get(key(a.company))?.apps ?? 0) + 1, jobs: m.get(key(a.company))?.jobs ?? 0 });
    for (const j of jobs) m.set(key(j.company), { apps: m.get(key(j.company))?.apps ?? 0, jobs: (m.get(key(j.company))?.jobs ?? 0) + 1 });
    return m;
  }, [apps, jobs]);
  const list = companies.filter((c) => !q || `${c.name} ${c.industry ?? ''} ${c.countries.join(' ')}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (counts.get(b.id)?.apps ?? 0) - (counts.get(a.id)?.apps ?? 0) || a.name.localeCompare(b.name));
  return (
    <>
      <PageHead title="Companies" sub={`${companies.length} companies from your applications, sources and research.`} />
      <div className="toolbar">
        <div className="grow"><Field label="Search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const cid = slugify(name);
            if (!cid) return;
            const t = new Date().toISOString();
            await store.save({ schemaVersion: SCHEMA_VERSION, kind: 'company', id: cid, createdAt: t, updatedAt: t, deletedAt: null, provenance: [{ source: 'user', at: t }], name: name.trim(), countries: [], researchNotes: '', contacts: [], interviewExpectations: [], ats: [] } satisfies Company);
            setName('');
            navigate('companies', cid);
          }}
        >
          <Field label="Add company"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <button className="btn" style={{ alignSelf: 'end' }} disabled={!name.trim()}>Add</button>
        </form>
      </div>
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Company</th><th>Countries</th><th>ATS boards</th><th>Applications</th><th>Jobs</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><a href={href('companies', c.id)} className="title">{c.name}</a>{c.industry && <div className="small muted">{c.industry}</div>}</td>
                  <td className="small">{c.countries.join(', ') || '—'}</td>
                  <td className="small mono">{c.ats.map((a) => `${a.kind}:${a.board}`).join(', ') || '—'}</td>
                  <td>{counts.get(c.id)?.apps ?? 0}</td>
                  <td>{counts.get(c.id)?.jobs ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No companies">Sync or add one above.</Empty>
      )}
    </>
  );
}

function CompanyDetail({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const c = store.record<Company>('company', id);
  const apps = useRecords<Application>('application');
  const [form, setForm] = useState(() => ({ website: c?.website ?? '', careersUrl: c?.careersUrl ?? '', industry: c?.industry ?? '', product: c?.product ?? '', researchNotes: c?.researchNotes ?? '' }));
  const [exp, setExp] = useState({ text: '', label: 'inferred' as 'sourced' | 'inferred', sourceUrl: '' });
  const [con, setCon] = useState({ name: '', title: '', sourceUrl: '' });
  const [preview, setPreview] = useState(false);
  if (!c) return <Empty title="Company not found" action={<a className="btn" href={href('companies')}>Back</a>} />;
  const related = apps.filter((a) => slugify(a.company.replace(/\(.*?\)/g, '')) === c.id);
  const save = async (patch: Partial<Company>) => {
    await store.save({ ...c, ...patch });
    toast('Saved');
  };
  return (
    <>
      <PageHead title={c.name} sub={c.countries.join(', ')} actions={<a className="btn" href={href('companies')}>← All companies</a>} />
      <div className="grid grid-2">
        <Card title="Profile">
          <div className="grid grid-2">
            <Field label="Official website"><input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
            <Field label="Careers page"><input type="url" value={form.careersUrl} onChange={(e) => setForm({ ...form, careersUrl: e.target.value })} /></Field>
            <Field label="Industry"><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
            <Field label="Product"><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <span className="small muted">Research notes (Markdown)</span>
            <button className="btn btn-sm btn-ghost right" onClick={() => setPreview((p) => !p)}>{preview ? 'Edit' : 'Preview'}</button>
          </div>
          {preview ? <Markdown text={form.researchNotes || '_No notes yet._'} /> : <textarea aria-label="Research notes" value={form.researchNotes} onChange={(e) => setForm({ ...form, researchNotes: e.target.value })} />}
          <button className="btn btn-sm btn-primary" style={{ marginTop: '0.5rem' }} onClick={() => save({ website: form.website || undefined, careersUrl: form.careersUrl || undefined, industry: form.industry || undefined, product: form.product || undefined, researchNotes: form.researchNotes })}>Save</button>
          {c.ats.length > 0 && <p className="small muted" style={{ marginTop: '0.75rem' }}>ATS boards polled: {c.ats.map((a) => `${a.kind}:${a.board}`).join(', ')}</p>}
          <p className="tiny muted">Provenance: {c.provenance.map((p) => `${p.source}${p.sourceRepo ? ` ${p.sourceRepo}/${p.sourcePath}` : ''}`).join('; ')}</p>
        </Card>
        <div className="stack">
          <Card title="Interview expectations" sub="Label each item: sourced (with a public URL) or inferred.">
            <ul className="list">
              {c.interviewExpectations.map((e, i) => (
                <li key={i}><Badge tone={e.label === 'sourced' ? 'ok' : 'warn'}>{e.label}</Badge><div className="grow small">{e.text}{e.sourceUrl && <div className="tiny"><a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{e.sourceUrl}</a></div>}</div></li>
              ))}
            </ul>
            <div className="grid grid-2" style={{ marginTop: '0.5rem' }}>
              <Field label="Expectation"><input value={exp.text} onChange={(e) => setExp({ ...exp, text: e.target.value })} placeholder="e.g. system design round on agent platforms" /></Field>
              <Field label="Label"><select value={exp.label} onChange={(e) => setExp({ ...exp, label: e.target.value as 'sourced' | 'inferred' })}><option value="inferred">inferred</option><option value="sourced">sourced</option></select></Field>
              {exp.label === 'sourced' && <Field label="Source URL"><input type="url" value={exp.sourceUrl} onChange={(e) => setExp({ ...exp, sourceUrl: e.target.value })} /></Field>}
            </div>
            <button className="btn btn-sm" disabled={!exp.text || (exp.label === 'sourced' && !/^https?:\/\//.test(exp.sourceUrl))} onClick={async () => { await save({ interviewExpectations: [...c.interviewExpectations, { text: exp.text, label: exp.label, sourceUrl: exp.sourceUrl || undefined }] }); setExp({ text: '', label: 'inferred', sourceUrl: '' }); }}>Add</button>
          </Card>
          <Card title="Published recruiter contacts" sub="Only from the posting or official pages, with source.">
            <ul className="list">
              {c.contacts.map((p) => (
                <li key={p.id}><div className="grow small"><strong>{p.name}</strong>{p.title && `, ${p.title}`}<div className="tiny"><a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{p.sourceUrl}</a></div></div></li>
              ))}
            </ul>
            <div className="grid grid-3">
              <Field label="Name"><input value={con.name} onChange={(e) => setCon({ ...con, name: e.target.value })} /></Field>
              <Field label="Title"><input value={con.title} onChange={(e) => setCon({ ...con, title: e.target.value })} /></Field>
              <Field label="Source URL"><input type="url" value={con.sourceUrl} onChange={(e) => setCon({ ...con, sourceUrl: e.target.value })} /></Field>
            </div>
            <button className="btn btn-sm" disabled={!con.name || !/^https?:\/\//.test(con.sourceUrl)} onClick={async () => { await save({ contacts: [...c.contacts, { id: newId('con'), name: con.name, title: con.title || undefined, sourceUrl: con.sourceUrl, addedAt: todayIso() }] }); setCon({ name: '', title: '', sourceUrl: '' }); }}>Add contact</button>
          </Card>
          <Card title="Applications">
            {related.length ? related.map((a) => <div key={a.id} className="small"><a href={href('applications', a.id)}>{a.id}</a> {a.role} · <Badge>{a.status}</Badge></div>) : <p className="small muted">None.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
