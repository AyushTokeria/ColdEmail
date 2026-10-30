import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { DraftResult, parseWith, wordCount } from '../ai/parse';
import { draftBatchPrompt } from '../ai/prompts';
import { CopyPasteFlow } from '../components/CopyPaste';
import { Alert, Page } from '../components/ui';
import { useBatches, useContact, useMessages, useProfile } from '../hooks';
import type { Message } from '../types';

export default function Review() {
  const { data: msgs = [], isLoading } = useMessages('draft,approved');
  const qc = useQueryClient();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const approved = msgs.filter((m) => m.status === 'approved');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['messages'] });
    qc.invalidateQueries({ queryKey: ['contacts'] });
  };

  const schedule = useMutation({
    mutationFn: () => api<{ scheduled: number }>('/messages/schedule', { method: 'POST', json: { messageIds: approved.map((m) => m.id) } }),
    onSuccess: () => {
      invalidate();
      nav('/queue');
    },
    onError: (e) => setErr(errMsg(e)),
  });

  return (
    <Page
      title={`Review drafts (${msgs.length})`}
      actions={
        <button className="btn btn-primary" disabled={approved.length === 0 || schedule.isPending} onClick={() => schedule.mutate()}>
          {schedule.isPending ? 'Scheduling…' : `Schedule ${approved.length} approved`}
        </button>
      }
    >
      <p className="mb-4 text-sm text-slate-600">Nothing is sent until you approve it and schedule it. Edit anything that doesn't sound like you.</p>
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {!isLoading && msgs.length === 0 && (
        <p className="text-sm text-slate-500">No drafts waiting. <Link className="underline" to="/drafts">Create some</Link>.</p>
      )}
      <div className="space-y-4">
        {msgs.map((m) => (
          <DraftCard key={`${m.id}-${m.status}`} m={m} onChange={invalidate} />
        ))}
      </div>
    </Page>
  );
}

function DraftCard({ m, onChange }: { m: Message; onChange: () => void }) {
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [err, setErr] = useState<string | null>(null);
  const [redo, setRedo] = useState(false);
  const dirty = subject !== m.subject || body !== m.body;
  const words = wordCount(body);

  const patch = useMutation({
    mutationFn: (status?: 'draft' | 'approved' | 'dismissed') => api(`/messages/${m.id}`, { method: 'PATCH', json: { subject, body, ...(status ? { status } : {}) } }),
    onSuccess: () => {
      setErr(null);
      onChange();
    },
    onError: (e) => setErr(errMsg(e)),
  });

  return (
    <div className={`card space-y-2 ${m.status === 'approved' ? 'border-green-300 bg-green-50/40' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div>
          <Link className="font-medium text-indigo-700 hover:underline" to={`/contacts/${m.contactId}`}>{m.contactName}</Link>{' '}
          <span className="text-slate-500">{m.firm}</span>{' '}
          <span className="chip">{m.step === 0 ? 'First email' : `Follow-up ${m.step}`}</span>
          {m.email ? <span className="ml-2 text-xs text-slate-500">{m.email}</span> : <span className="ml-2 text-xs text-amber-700">no email address</span>}
        </div>
        <span className={`text-xs ${words > 130 ? 'text-amber-700' : 'text-slate-500'}`}>{words} words</span>
      </div>
      <input className="input font-medium" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input h-48 leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
      {err && <Alert>{err}</Alert>}
      <div className="flex flex-wrap gap-2">
        {m.status === 'approved' && !dirty ? (
          <button className="btn" onClick={() => patch.mutate('draft')}>Unapprove</button>
        ) : (
          <button className="btn btn-primary" disabled={patch.isPending} onClick={() => patch.mutate('approved')}>Approve</button>
        )}
        {dirty && <button className="btn" disabled={patch.isPending} onClick={() => patch.mutate(undefined)}>Save edits</button>}
        {m.step === 0 && <button className="btn" onClick={() => setRedo(!redo)}>Redo with Claude…</button>}
        <button className="btn btn-danger ml-auto" onClick={() => patch.mutate('dismissed')}>Skip</button>
      </div>
      {redo && <Redo m={m} onApply={(s, b) => { setSubject(s); setBody(b); setRedo(false); }} />}
    </div>
  );
}

function Redo({ m, onApply }: { m: Message; onApply: (s: string, b: string) => void }) {
  const { data: c } = useContact(m.contactId);
  const { data: prof } = useProfile();
  const { data: batches = [] } = useBatches();
  const [note, setNote] = useState('Make it shorter and more direct.');
  const [debounced, setDebounced] = useState(note);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(note), 300);
    return () => clearTimeout(t);
  }, [note]);
  const batch = batches.find((b) => b.id === m.batchId);
  if (!c || !prof || !batch) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <input className="input" placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} />
      <CopyPasteFlow
        title="Rewrite this email"
        prompt={draftBatchPrompt(prof.data, batch, [{ contact: c, commonalities: c.commonalities }], `${debounced}\nThe current draft was:\nSubject: ${m.subject}\n${m.body}`)}
        onReply={(text) => {
          const r = parseWith(DraftResult, text);
          if (!r.ok) return r.error;
          const d = r.value.drafts.find((x) => x.contactId === m.contactId) ?? r.value.drafts[0];
          if (!d) return 'No draft found in the reply.';
          onApply(d.subject, d.body);
          return null;
        }}
      />
    </div>
  );
}
