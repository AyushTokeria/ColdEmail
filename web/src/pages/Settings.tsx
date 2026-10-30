import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errMsg, loginUrl, setToken } from '../api';
import { Alert, Field, Page } from '../components/ui';

interface Followups { days: [number, number]; templates: { step1: string[]; step2: string[] } }

export default function SettingsPage() {
  const qc = useQueryClient();
  const gmail = useQuery({ queryKey: ['gmail'], queryFn: () => api<{ connected: boolean; email?: string; error?: string }>('/gmail/status') });
  const fu = useQuery({ queryKey: ['followups'], queryFn: () => api<Followups>('/settings/followups') });
  const [f, setF] = useState<Followups | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => { if (fu.data) setF(fu.data); }, [fu.data]);

  const save = useMutation({
    mutationFn: () => api<Followups>('/settings/followups', { method: 'PUT', json: f }),
    onSuccess: (v) => { setF(v); setMsg({ kind: 'ok', text: 'Follow-up settings saved.' }); qc.invalidateQueries({ queryKey: ['followups'] }); },
    onError: (e) => setMsg({ kind: 'error', text: errMsg(e) }),
  });

  async function exportAll() {
    const [profile, contacts, messages, batches] = await Promise.all([api('/profile'), api('/contacts'), api('/messages'), api('/batches')]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, contacts, messages, batches }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coldemails-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const setTpl = (step: 'step1' | 'step2', i: number, v: string) => f && setF({ ...f, templates: { ...f.templates, [step]: f.templates[step].map((t, j) => (j === i ? v : t)) } });

  return (
    <Page title="Settings" actions={<button className="btn" onClick={async () => { await api('/logout', { method: 'POST' }).catch(() => {}); setToken(null); window.dispatchEvent(new Event('coldemails:logout')); }}>Sign out</button>}>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="font-semibold">Gmail</h2>
          {gmail.data?.connected ? <Alert kind="ok">Connected as {gmail.data.email}. Emails send from this address and appear in its Sent folder.</Alert> : <Alert kind="warn">Not connected. {gmail.data?.error}</Alert>}
          <a className="btn" href={loginUrl()}>Reconnect Gmail</a>
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">Your data</h2>
          <p className="text-sm text-slate-600">Everything lives in your own Cloudflare database. Download a copy any time.</p>
          <button className="btn" onClick={exportAll}>Download JSON export</button>
        </section>

        {f && (
          <section className="card space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Follow-ups</h2>
              <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            </div>
            <p className="text-sm text-slate-600">If someone hasn't replied, a follow-up is drafted in the same thread for you to approve. The second one replaces the first if it is still unsent. Placeholders: {'{firstName} {firm} {connection} {senderFirstName}'}.</p>
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <Field label="First follow-up after (days)"><input className="input" type="number" min={1} value={f.days[0]} onChange={(e) => setF({ ...f, days: [Number(e.target.value), f.days[1]] })} /></Field>
              <Field label="Second after (days)"><input className="input" type="number" min={2} value={f.days[1]} onChange={(e) => setF({ ...f, days: [f.days[0], Number(e.target.value)] })} /></Field>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <span className="label">First follow-up templates (one is picked per person)</span>
                {f.templates.step1.map((t, i) => <textarea key={i} className="input h-32" value={t} onChange={(e) => setTpl('step1', i, e.target.value)} />)}
              </div>
              <div className="space-y-2">
                <span className="label">Second follow-up templates</span>
                {f.templates.step2.map((t, i) => <textarea key={i} className="input h-32" value={t} onChange={(e) => setTpl('step2', i, e.target.value)} />)}
              </div>
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
