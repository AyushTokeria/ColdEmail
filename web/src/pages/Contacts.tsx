import { useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';
import { INDUSTRY_LIST } from '../ai/industries';
import { findCommonalities } from '../ai/match';
import { LinkedInResult, parseWith } from '../ai/parse';
import { chunk, parseLinkedInPrompt } from '../ai/prompts';
import { CopyPasteFlow } from '../components/CopyPaste';
import { Alert, Field, Page, StatusBadge, fullName } from '../components/ui';
import { useContacts, useProfile } from '../hooks';
import { CONTACT_STATUSES, STATUS_LABEL, type Contact, type ContactStatus, type ProfileData } from '../types';

type Mode = null | 'add' | 'csv' | 'linkedin';

/** Computes local similarities for contacts and stores them (replacing the previous local set). */
export async function storeLocalCommonalities(profile: ProfileData, contacts: Contact[]) {
  await Promise.all(
    contacts.map((c) => api(`/contacts/${c.id}/commonalities`, { method: 'PUT', json: { origin: 'local', items: findCommonalities(profile, { ...c, rawText: `${c.rawText}\n${c.notes}` }) } })),
  );
}

export default function Contacts() {
  const { data: contacts = [], isLoading } = useContacts();
  const { data: prof } = useProfile();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [filter, setFilter] = useState<ContactStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  const rescore = useMutation({
    mutationFn: async () => {
      if (!prof) return;
      await storeLocalCommonalities(prof.data, contacts);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setNote({ kind: 'ok', text: 'Shared connections recalculated for every contact.' });
    },
    onError: (e) => setNote({ kind: 'error', text: errMsg(e) }),
  });

  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return contacts.filter((c) => (filter === 'all' || c.status === filter) && (!s || `${fullName(c)} ${c.firm} ${c.role}`.toLowerCase().includes(s)));
  }, [contacts, filter, q]);

  const hasProfile = !!prof && Object.keys(prof.data).length > 0;

  /** After inserting new contacts, compute and store their local connections. */
  async function afterInsert(ids: (number | null)[]) {
    const fresh = (await api<Contact[]>('/contacts')).filter((c) => ids.includes(c.id));
    if (prof && hasProfile) await storeLocalCommonalities(prof.data, fresh);
    qc.invalidateQueries({ queryKey: ['contacts'] });
  }

  return (
    <Page
      title={`Contacts (${contacts.length})`}
      actions={
        <>
          <button className="btn" onClick={() => setMode(mode === 'add' ? null : 'add')}>
            + Add
          </button>
          <button className="btn" onClick={() => setMode(mode === 'csv' ? null : 'csv')}>
            Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setMode(mode === 'linkedin' ? null : 'linkedin')}>
            Paste LinkedIn
          </button>
        </>
      }
    >
      {!hasProfile && (
        <div className="mb-4">
          <Alert kind="warn">
            Fill in your <Link className="underline" to="/profile">profile</Link> first so shared connections can be found.
          </Alert>
        </div>
      )}
      {note && (
        <div className="mb-4">
          <Alert kind={note.kind}>{note.text}</Alert>
        </div>
      )}

      {mode === 'add' && <AddForm onDone={async (id) => { setMode(null); await afterInsert([id]); }} onError={(t) => setNote({ kind: 'error', text: t })} />}
      {mode === 'csv' && <CsvImport onDone={async (ids, skipped) => { setMode(null); setNote({ kind: 'ok', text: `Imported ${ids.length} contact(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}.` }); await afterInsert(ids); }} />}
      {mode === 'linkedin' && <LinkedInImport onDone={async (ids, msg) => { setMode(null); setNote({ kind: 'ok', text: msg }); await afterInsert(ids); }} />}

      <div className="mb-3 mt-2 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search name, firm, role…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as ContactStatus | 'all')}>
          <option value="all">All statuses</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="btn ml-auto" disabled={!hasProfile || rescore.isPending || contacts.length === 0} onClick={() => rescore.mutate()}>
          {rescore.isPending ? 'Matching…' : 'Recalculate connections'}
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role · Firm</th>
              <th className="px-3 py-2">Best connection</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono">{c.score}</td>
                <td className="px-3 py-2">
                  <Link className="font-medium text-indigo-700 hover:underline" to={`/contacts/${c.id}`}>
                    {fullName(c) || '(no name)'}
                  </Link>
                  {c.stale && (
                    <span title="The latest role on the pasted profile has ended, or has no dates. Check their current firm." className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      may be stale
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">{[c.role, c.firm].filter(Boolean).join(' · ')}</td>
                <td className="px-3 py-2 text-slate-600">{c.topConnection ?? <span className="text-slate-400">none found</span>}</td>
                <td className="px-3 py-2">{c.email || <span className="text-amber-700">missing</span>}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  No contacts yet. Add one, import a CSV, or paste LinkedIn profiles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

function AddForm({ onDone, onError }: { onDone: (id: number) => void; onError: (t: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', firm: '', role: '', group: '', location: '', industry: 'ib', notes: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/contacts', { method: 'POST', json: { ...f, source: 'form' } }),
    onSuccess: (r) => onDone(r.id),
    onError: (e) => onError(errMsg(e)),
  });
  return (
    <div className="card mb-4 grid gap-3 sm:grid-cols-3">
      <Field label="First name"><input className="input" value={f.firstName} onChange={set('firstName')} /></Field>
      <Field label="Last name"><input className="input" value={f.lastName} onChange={set('lastName')} /></Field>
      <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Firm"><input className="input" value={f.firm} onChange={set('firm')} /></Field>
      <Field label="Role"><input className="input" value={f.role} onChange={set('role')} /></Field>
      <Field label="Group / desk / practice"><input className="input" value={f.group} onChange={set('group')} /></Field>
      <Field label="Location"><input className="input" value={f.location} onChange={set('location')} /></Field>
      <Field label="Industry">
        <select className="input" value={f.industry} onChange={set('industry')}>
          {INDUSTRY_LIST.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
      </Field>
      <div />
      <Field label="What you have in common, or anything useful (school, hometown, a post they wrote…)" className="sm:col-span-3">
        <textarea className="input h-20" value={f.notes} onChange={set('notes')} />
      </Field>
      <div className="sm:col-span-3">
        <button className="btn btn-primary" disabled={(!f.firstName && !f.lastName) || create.isPending} onClick={() => create.mutate()}>
          Add contact
        </button>
      </div>
    </div>
  );
}

const FIELD_ALIASES: Record<string, string[]> = {
  firstName: ['first name', 'firstname', 'first'],
  lastName: ['last name', 'lastname', 'last', 'surname'],
  email: ['email', 'e-mail', 'email address'],
  firm: ['firm', 'company', 'organization', 'employer', 'bank'],
  role: ['role', 'title', 'position', 'job title'],
  group: ['group', 'team', 'desk', 'practice', 'division'],
  location: ['location', 'city', 'office'],
  industry: ['industry', 'sector'],
  notes: ['notes', 'similarities', 'commonalities', 'common', 'in common'],
};

function CsvImport({ onDone }: { onDone: (ids: (number | null)[], skipped: number) => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const imp = useMutation({
    mutationFn: async () => {
      const contacts = rows.map((r) => {
        const o: Record<string, string> = { source: 'csv' };
        for (const [field, col] of Object.entries(map)) if (col) o[field] = r[col] ?? '';
        return o;
      });
      const out: { ids: (number | null)[]; skipped: number } = { ids: [], skipped: 0 };
      for (const part of chunk(contacts, 100)) {
        const r = await api<{ ids: (number | null)[]; skipped: number }>('/contacts/bulk', { method: 'POST', json: { contacts: part } });
        out.ids.push(...r.ids.filter(Boolean));
        out.skipped += r.skipped;
      }
      return out;
    },
    onSuccess: (r) => onDone(r.ids, r.skipped),
    onError: (e) => setErr(errMsg(e)),
  });

  function load(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields ?? [];
        setHeaders(hs);
        setRows(res.data);
        const m: Record<string, string> = {};
        for (const [field, names] of Object.entries(FIELD_ALIASES)) m[field] = hs.find((h) => names.includes(h.trim().toLowerCase())) ?? '';
        setMap(m);
        setErr(res.errors.length ? `Some rows could not be read (${res.errors[0].message}).` : null);
      },
    });
  }

  return (
    <div className="card mb-4 space-y-3">
      <p className="text-sm text-slate-600">Upload a CSV with a header row. Rows with an email that already exists are skipped.</p>
      <input type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      {err && <Alert>{err}</Alert>}
      {headers.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.keys(FIELD_ALIASES).map((field) => (
              <Field key={field} label={field}>
                <select className="input" value={map[field] ?? ''} onChange={(e) => setMap({ ...map, [field]: e.target.value })}>
                  <option value="">(skip)</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <p className="text-sm">{rows.length} row(s) found. Preview of the first: <span className="text-slate-600">{JSON.stringify(rows[0])}</span></p>
          <button className="btn btn-primary" disabled={imp.isPending || (!map.firstName && !map.lastName)} onClick={() => imp.mutate()}>
            {imp.isPending ? 'Importing…' : `Import ${rows.length} contacts`}
          </button>
        </>
      )}
    </div>
  );
}

function LinkedInImport({ onDone }: { onDone: (ids: (number | null)[], msg: string) => void }) {
  const [blocks, setBlocks] = useState<string[]>(['']);
  const [step, setStep] = useState<'paste' | 'reply'>('paste');
  const items = blocks.map((text, i) => ({ id: i + 1, text })).filter((b) => b.text.trim().length > 20);
  const texts = Object.fromEntries(items.map((i) => [String(i.id), i.text]));

  return (
    <div className="card mb-4 space-y-3">
      {step === 'paste' ? (
        <>
          <p className="text-sm text-slate-600">
            Open each person's LinkedIn profile, select all (Ctrl/Cmd+A), copy, and paste into a box. Add as many as you like (up to 10 per round). LinkedIn data is often out of date, so profiles whose latest role has ended are flagged.
          </p>
          {blocks.map((b, i) => (
            <div key={i} className="flex gap-2">
              <textarea className="input h-24 font-mono text-xs" placeholder={`Profile ${i + 1} text…`} value={b} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? e.target.value : x)))} />
              {blocks.length > 1 && <button className="btn self-start" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <div className="flex gap-2">
            {blocks.length < 10 && <button className="btn" onClick={() => setBlocks([...blocks, ''])}>+ Another profile</button>}
            <button className="btn btn-primary" disabled={items.length === 0} onClick={() => setStep('reply')}>
              Next: get Claude to read them ({items.length})
            </button>
          </div>
        </>
      ) : (
        <>
          <CopyPasteFlow
            title="Extract the profiles"
            prompt={parseLinkedInPrompt(items)}
            onReply={async (text) => {
              const r = parseWith(LinkedInResult, text);
              if (!r.ok) return r.error;
              const found = r.value.contacts.filter((c) => texts[c.id]);
              if (found.length === 0) return 'None of the ids in the reply matched your profiles. Make sure Claude copied the ids exactly.';
              const payload = found.map((c) => ({
                firstName: c.firstName,
                lastName: c.lastName,
                firm: c.firm,
                role: c.role,
                group: c.group,
                location: c.location,
                education: c.education,
                experience: c.experience,
                rawText: texts[c.id],
                source: 'linkedin',
                stale: c.currentRoleEnded || !c.hasDates,
              }));
              const res = await api<{ ids: (number | null)[]; inserted: number; skipped: number }>('/contacts/bulk', { method: 'POST', json: { contacts: payload } });
              const stale = payload.filter((p) => p.stale).length;
              onDone(res.ids.filter(Boolean), `Added ${res.inserted} contact(s) from LinkedIn.${stale ? ` ${stale} may be out of date (flagged). Add their email addresses and check their current firm.` : ''} Add emails on each contact's page.`);
              return null;
            }}
          />
          <button className="btn" onClick={() => setStep('paste')}>← Back</button>
        </>
      )}
    </div>
  );
}
