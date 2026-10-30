import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { INDUSTRIES, INDUSTRY_LIST } from '../ai/industries';
import { checkDraft, DraftResult, parseWith, toCommonality, type DraftCheck } from '../ai/parse';
import { chunk, draftBatchPrompt, type DraftContact } from '../ai/prompts';
import { CopyPasteFlow } from '../components/CopyPaste';
import { Alert, Field, Page, fullName } from '../components/ui';
import { useContacts, useProfile } from '../hooks';
import type { Batch, ContactDetail, IndustryKey } from '../types';

const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 7]] as const;

export default function Batches() {
  const { data: contacts = [] } = useContacts();
  const { data: prof } = useProfile();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [form, setForm] = useState({
    name: `Batch ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    industry: 'ib' as IndustryKey,
    ask: '',
    instructions: '',
    windowDays: [1, 2, 3, 4, 5],
    windowStart: 9,
    windowEnd: 17,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    dailyCap: 25,
    attachResume: true,
  });
  const [run, setRun] = useState<{ batch: Batch; items: DraftContact[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const eligible = useMemo(() => contacts.filter((c) => ['new', 'drafted'].includes(c.status)), [contacts]);
  const ind = INDUSTRIES[form.industry];

  const start = useMutation({
    mutationFn: async () => {
      const [{ id }, details] = await Promise.all([
        api<{ id: number }>('/batches', { method: 'POST', json: form }),
        Promise.all(selected.map((id) => api<ContactDetail>(`/contacts/${id}`))),
      ]);
      const batch: Batch = { ...form, id };
      const items: DraftContact[] = details
        .sort((a, b) => b.score - a.score)
        .map((d) => ({ contact: d, commonalities: d.commonalities }));
      return { batch, items };
    },
    onSuccess: (r) => {
      setRun(r);
      setErr(null);
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
    onError: (e) => setErr(errMsg(e)),
  });

  if (run && prof) return <Runner batch={run.batch} profile={prof.data} items={run.items} onBack={() => setRun(null)} />;

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const noEmail = selected.filter((id) => !contacts.find((c) => c.id === id)?.email).length;

  return (
    <Page title="New drafts">
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="card space-y-3">
          <h2 className="font-semibold">1. Settings</h2>
          <Field label="Batch name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Industry (changes the tone and ask)">
            <select className="input" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value as IndustryKey })}>
              {INDUSTRY_LIST.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="The ask">
            <input className="input" placeholder={ind.defaultAsk} value={form.ask} onChange={(e) => setForm({ ...form, ask: e.target.value })} />
          </Field>
          <Field label="Extra instructions for Claude (optional)">
            <textarea className="input h-16" placeholder="e.g. mention I'm recruiting for summer 2027 analyst roles" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          </Field>
          <hr />
          <h3 className="text-sm font-semibold">Sending window</h3>
          <p className="text-xs text-slate-500">Approved emails are sent at random times inside this window, even when this tab is closed.</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([label, n]) => (
              <label key={n} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={form.windowDays.includes(n)} onChange={(e) => setForm({ ...form, windowDays: e.target.checked ? [...form.windowDays, n] : form.windowDays.filter((d) => d !== n) })} />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="From (hour)"><input className="input" type="number" min={0} max={23} value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: Number(e.target.value) })} /></Field>
            <Field label="Until (hour)"><input className="input" type="number" min={1} max={24} value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: Number(e.target.value) })} /></Field>
            <Field label="Max per day"><input className="input" type="number" min={1} max={100} value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Timezone"><input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.attachResume} onChange={(e) => setForm({ ...form, attachResume: e.target.checked })} />
            Attach my resume to first emails{!prof?.resume && form.attachResume ? ' (none uploaded yet)' : ''}
          </label>
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">2. Who to write to ({selected.length})</h2>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setSelected(eligible.slice(0, 10).map((c) => c.id))}>Top 10</button>
              <button className="btn" onClick={() => setSelected([])}>Clear</button>
            </div>
          </div>
          {eligible.length === 0 && <p className="text-sm text-slate-500">No contacts ready. <Link className="underline" to="/contacts">Add some</Link>.</p>}
          <ul className="max-h-[28rem] divide-y overflow-auto rounded-md border border-slate-200">
            {eligible.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="w-8 font-mono text-slate-500">{c.score}</span>
                  <span className="flex-1">
                    <span className="font-medium">{fullName(c)}</span> <span className="text-slate-500">{[c.role, c.firm].filter(Boolean).join(' · ')}</span>
                    <span className="block text-xs text-slate-500">{c.topConnection ?? 'no shared connection found'}</span>
                  </span>
                  {!c.email && <span className="text-xs text-amber-700">no email</span>}
                  {c.status === 'drafted' && <span className="chip">has draft</span>}
                </label>
              </li>
            ))}
          </ul>
          {noEmail > 0 && <Alert kind="warn">{noEmail} selected contact(s) have no email address. You can still draft; add the address before approving.</Alert>}
          <p className="text-xs text-slate-500">{selected.length > 0 ? `That's ${chunk(selected).length} prompt(s) of up to 10 contacts each.` : 'Select up to a few dozen; they are split into prompts of 10.'}</p>
          <button className="btn btn-primary" disabled={selected.length === 0 || form.windowDays.length === 0 || form.windowEnd <= form.windowStart || start.isPending || !prof} onClick={() => start.mutate()}>
            {start.isPending ? 'Preparing…' : 'Next: get drafts from Claude →'}
          </button>
        </section>
      </div>
    </Page>
  );
}

interface Preview {
  contactId: number;
  name: string;
  subject: string;
  body: string;
  checks: DraftCheck[];
  extras: ReturnType<typeof toCommonality>[];
  keep: boolean;
}

function Runner({ batch, profile, items, onBack }: { batch: Batch; profile: import('../types').ProfileData; items: DraftContact[]; onBack: () => void }) {
  const chunks = chunk(items);
  const [idx, setIdx] = useState(0);
  const [saved, setSaved] = useState<number[]>([]);
  const nav = useNavigate();
  const qc = useQueryClient();
  const group = chunks[idx];

  return (
    <Page title={`${batch.name}: drafts`} actions={<button className="btn" onClick={onBack}>← Settings</button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        {chunks.map((_, i) => (
          <button key={i} className={`btn ${i === idx ? 'btn-primary' : ''}`} onClick={() => setIdx(i)}>
            Prompt {i + 1}/{chunks.length} {saved.includes(i) ? '✓' : ''}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <ChunkFlow
            key={idx}
            batch={batch}
            profile={profile}
            group={group}
            onSaved={() => {
              setSaved((s) => [...new Set([...s, idx])]);
              qc.invalidateQueries({ queryKey: ['contacts'] });
              qc.invalidateQueries({ queryKey: ['messages'] });
              if (idx < chunks.length - 1) setIdx(idx + 1);
            }}
          />
        </section>
        <section className="card text-sm">
          <h3 className="mb-2 font-semibold">In this prompt</h3>
          <ul className="space-y-1">
            {group.map(({ contact, commonalities }) => (
              <li key={contact.id}>
                <span className="font-medium">{fullName(contact)}</span> <span className="text-slate-500">{contact.firm}</span>
                <div className="text-xs text-slate-500">{commonalities.filter((c) => c.selected).map((c) => c.detail).join(' · ') || 'no shared connection found yet'}</div>
              </li>
            ))}
          </ul>
          {saved.length === chunks.length && (
            <div className="mt-4">
              <Alert kind="ok">All drafts saved.</Alert>
              <button className="btn btn-primary mt-2" onClick={() => nav('/review')}>Review &amp; approve →</button>
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}

function ChunkFlow({ batch, profile, group, onSaved }: { batch: Batch; profile: import('../types').ProfileData; group: DraftContact[]; onSaved: () => void }) {
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const prompt = draftBatchPrompt(profile, batch, group);

  const save = useMutation({
    mutationFn: async () => {
      const keep = (preview ?? []).filter((p) => p.keep);
      await api('/messages/bulk', { method: 'POST', json: { batchId: batch.id, items: keep.map((p) => ({ contactId: p.contactId, subject: p.subject, body: p.body })) } });
      await Promise.all(keep.filter((p) => p.extras.length).map((p) => api(`/contacts/${p.contactId}/commonalities`, { method: 'PUT', json: { origin: 'claude', items: p.extras } })));
    },
    onSuccess: onSaved,
  });

  return (
    <div className="space-y-4">
      <CopyPasteFlow
        title="Get the drafts"
        help="Claude writes one email per person using the connections shown on the right."
        prompt={prompt}
        onReply={(text) => {
          const r = parseWith(DraftResult, text);
          if (!r.ok) return r.error;
          const byId = new Map(group.map((g) => [g.contact.id, g]));
          const out: Preview[] = [];
          for (const d of r.value.drafts) {
            const g = byId.get(d.contactId);
            if (!g) continue;
            out.push({
              contactId: d.contactId,
              name: fullName(g.contact),
              subject: d.subject,
              body: d.body,
              checks: checkDraft(d, { email: g.contact.email, rawText: `${g.contact.rawText}\n${g.contact.notes}` }, g.commonalities),
              extras: d.extraConnections.map(toCommonality),
              keep: true,
            });
          }
          if (out.length === 0) return 'None of the contact ids in the reply matched this prompt. Make sure you pasted the reply to THIS prompt.';
          setMissing(group.filter((g) => !out.some((o) => o.contactId === g.contact.id)).map((g) => fullName(g.contact)));
          setPreview(out);
          return null;
        }}
      />

      {preview && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Preview ({preview.length})</h3>
          {missing.length > 0 && <Alert kind="warn">No draft came back for: {missing.join(', ')}. Ask Claude "you missed these contacts" or draft them in the next batch.</Alert>}
          {preview.map((p, i) => (
            <div key={p.contactId} className="rounded-md border border-slate-200 p-3 text-sm">
              <label className="mb-1 flex items-center gap-2 font-medium">
                <input type="checkbox" checked={p.keep} onChange={(e) => setPreview(preview.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                {p.name}
              </label>
              <div className="font-medium">{p.subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-slate-700">{p.body}</pre>
              {p.checks.map((c, k) => (
                <p key={k} className={`mt-1 text-xs ${c.level === 'error' ? 'text-red-700' : 'text-amber-700'}`}>⚠ {c.message}</p>
              ))}
            </div>
          ))}
          <button className="btn btn-primary" disabled={save.isPending || !preview.some((p) => p.keep)} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : `Save ${preview.filter((p) => p.keep).length} draft(s)`}
          </button>
          {save.error && <Alert>{errMsg(save.error)}</Alert>}
        </div>
      )}
    </div>
  );
}
