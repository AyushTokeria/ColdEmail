import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import { INDUSTRY_LIST } from '../ai/industries';
import { Alert, Field, Page, StatusBadge, fmtDate, fullName } from '../components/ui';
import { useContact } from '../hooks';
import { CONTACT_STATUSES, STATUS_LABEL, type CommonalityType, type ContactDetail } from '../types';

const TYPES: CommonalityType[] = ['high_school', 'hometown', 'university', 'employer', 'language', 'club', 'sport', 'other'];

export default function ContactDetailPage() {
  const id = Number(useParams().id);
  const { data: c, isLoading } = useContact(id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState<Partial<ContactDetail>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newC, setNewC] = useState({ type: 'other' as CommonalityType, detail: '', strength: 2 });

  useEffect(() => {
    if (c) setF(c);
  }, [c]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] });
    qc.invalidateQueries({ queryKey: ['contacts'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/contacts/${id}`, {
        method: 'PATCH',
        json: { firstName: f.firstName, lastName: f.lastName, email: f.email, firm: f.firm, role: f.role, group: f.group, location: f.location, industry: f.industry, notes: f.notes, status: f.status, coffeeChatAt: f.coffeeChatAt ?? '', stale: f.stale },
      }),
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Saved.' });
      refresh();
    },
    onError: (e) => setMsg({ kind: 'error', text: errMsg(e) }),
  });

  const toggle = useMutation({
    mutationFn: (v: { cid: number; selected: boolean }) => api(`/commonalities/${v.cid}`, { method: 'PATCH', json: { selected: v.selected } }),
    onSuccess: refresh,
  });

  const addManual = useMutation({
    mutationFn: () => {
      const existing = (c?.commonalities ?? []).filter((x) => x.origin === 'manual');
      return api(`/contacts/${id}/commonalities`, { method: 'PUT', json: { origin: 'manual', items: [...existing, { ...newC, evidence: 'Added by you', selected: true }] } });
    },
    onSuccess: () => {
      setNewC({ ...newC, detail: '' });
      refresh();
    },
    onError: (e) => setMsg({ kind: 'error', text: errMsg(e) }),
  });

  const del = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      nav('/contacts');
    },
  });

  if (isLoading || !c) return <p className="text-sm text-slate-500">Loading…</p>;
  const set = (k: keyof ContactDetail) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Page
      title={fullName(c) || 'Contact'}
      actions={
        <>
          <Link className="btn" to="/contacts">← Contacts</Link>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
        </>
      }
    >
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {c.stale && (
        <div className="mb-4">
          <Alert kind="warn">
            The pasted LinkedIn profile may be out of date{c.pastedAt ? ` (pasted ${fmtDate(c.pastedAt, { month: 'short', day: 'numeric', year: 'numeric' })})` : ''}. Confirm their current firm and role before sending.
            <label className="ml-3 inline-flex items-center gap-1"><input type="checkbox" checked={!f.stale} onChange={(e) => setF({ ...f, stale: !e.target.checked })} /> I checked</label>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card grid grid-cols-2 gap-3">
          <Field label="First name"><input className="input" value={f.firstName ?? ''} onChange={set('firstName')} /></Field>
          <Field label="Last name"><input className="input" value={f.lastName ?? ''} onChange={set('lastName')} /></Field>
          <Field label="Email" className="col-span-2"><input className="input" type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
          <Field label="Firm"><input className="input" value={f.firm ?? ''} onChange={set('firm')} /></Field>
          <Field label="Role"><input className="input" value={f.role ?? ''} onChange={set('role')} /></Field>
          <Field label="Group / desk / practice"><input className="input" value={f.group ?? ''} onChange={set('group')} /></Field>
          <Field label="Location"><input className="input" value={f.location ?? ''} onChange={set('location')} /></Field>
          <Field label="Industry">
            <select className="input" value={f.industry ?? ''} onChange={set('industry')}>
              <option value="">(none)</option>
              {INDUSTRY_LIST.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={f.status ?? 'new'} onChange={set('status')}>
              {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Coffee chat date" className="col-span-2">
            <input className="input" type="datetime-local" value={(f.coffeeChatAt ?? '').slice(0, 16)} onChange={(e) => setF({ ...f, coffeeChatAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </Field>
          <Field label="Notes (private; also given to Claude when drafting)" className="col-span-2">
            <textarea className="input h-24" value={f.notes ?? ''} onChange={set('notes')} />
          </Field>
          <div className="col-span-2 flex items-center justify-between">
            <StatusBadge status={c.status} />
            <button className="btn btn-danger" onClick={() => confirm('Delete this contact and their messages?') && del.mutate()}>Delete</button>
          </div>
        </section>

        <div className="space-y-4">
          <section className="card space-y-2">
            <h2 className="font-semibold">Shared connections <span className="font-normal text-slate-500">(score {c.score})</span></h2>
            <p className="text-xs text-slate-500">Ticked connections are used when drafting. Untick any that are wrong.</p>
            {c.commonalities.length === 0 && <p className="text-sm text-slate-500">None found yet. They appear after you add your profile and click "Recalculate connections", or when you draft.</p>}
            <ul className="space-y-1.5">
              {c.commonalities.map((x) => (
                <li key={x.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={x.selected} onChange={(e) => toggle.mutate({ cid: x.id!, selected: e.target.checked })} />
                  <div>
                    <div>
                      {x.detail} <span className="chip ml-1">{x.type.replace('_', ' ')}</span> <span className="chip">strength {x.strength}</span>
                      {x.origin === 'claude' && <span className="chip ml-1 bg-violet-100 text-violet-800">from Claude</span>}
                    </div>
                    {x.evidence && <div className="text-xs text-slate-500">“{x.evidence}”</div>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <select className="input w-auto" value={newC.type} onChange={(e) => setNewC({ ...newC, type: e.target.value as CommonalityType })}>
                {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
              <input className="input min-w-[10rem] flex-1" placeholder="e.g. Both grew up in Pune" value={newC.detail} onChange={(e) => setNewC({ ...newC, detail: e.target.value })} />
              <select className="input w-auto" value={newC.strength} onChange={(e) => setNewC({ ...newC, strength: Number(e.target.value) })}>
                <option value={1}>weak</option><option value={2}>good</option><option value={3}>strong</option>
              </select>
              <button className="btn" disabled={!newC.detail.trim()} onClick={() => addManual.mutate()}>Add</button>
            </div>
          </section>

          <section className="card space-y-2">
            <h2 className="font-semibold">Messages</h2>
            {c.messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
            {c.messages.map((m) => (
              <div key={m.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="chip">{m.step === 0 ? 'First email' : `Follow-up ${m.step}`}</span>
                  <span className="chip">{m.status}</span>
                  {m.sentAt && <span>sent {fmtDate(m.sentAt)}</span>}
                  {m.scheduledFor && m.status === 'scheduled' && <span>scheduled {fmtDate(m.scheduledFor)}</span>}
                </div>
                <div className="font-medium">{m.subject}</div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{m.body}</pre>
                {m.error && <p className="mt-1 text-xs text-red-700">{m.error}</p>}
              </div>
            ))}
          </section>

          {c.rawText && (
            <details className="card text-sm">
              <summary className="cursor-pointer font-semibold">Pasted LinkedIn text</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-xs text-slate-600">{c.rawText}</pre>
            </details>
          )}
        </div>
      </div>
    </Page>
  );
}
