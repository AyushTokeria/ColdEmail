import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';
import { Alert, Page, fmtDate } from '../components/ui';
import { useMessages } from '../hooks';
import type { Message } from '../types';

export default function Queue() {
  const { data: msgs = [] } = useMessages('scheduled,sent,failed,approved');
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['messages'] });
    qc.invalidateQueries({ queryKey: ['contacts'] });
  };
  const act = useMutation({
    mutationFn: (v: { path: string; method?: string; json?: unknown }) => api(v.path, { method: v.method ?? 'POST', json: v.json }),
    onSuccess: refresh,
  });
  const runNow = useMutation({ mutationFn: () => api('/cron/run', { method: 'POST' }), onSuccess: refresh });

  const scheduled = msgs.filter((m) => m.status === 'scheduled').sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
  const failed = msgs.filter((m) => m.status === 'failed');
  const sent = msgs.filter((m) => m.status === 'sent');

  const row = (m: Message, actions?: React.ReactNode) => (
    <tr key={m.id} className="border-b last:border-0">
      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.status === 'sent' ? m.sentAt : m.scheduledFor)}</td>
      <td className="px-3 py-2"><Link className="text-indigo-700 hover:underline" to={`/contacts/${m.contactId}`}>{m.contactName}</Link> <span className="text-slate-500">{m.firm}</span></td>
      <td className="px-3 py-2">{m.step === 0 ? '' : <span className="chip mr-1">follow-up {m.step}</span>}{m.subject}{m.error && <div className="text-xs text-red-700">{m.error}</div>}</td>
      <td className="px-3 py-2 text-right">{actions}</td>
    </tr>
  );

  const table = (title: string, rows: Message[], mk?: (m: Message) => React.ReactNode, empty = 'Nothing here.') => (
    <section className="card p-0">
      <h2 className="border-b px-3 py-2 font-semibold">{title} ({rows.length})</h2>
      <table className="w-full text-left text-sm">
        <tbody>{rows.length ? rows.map((m) => row(m, mk?.(m))) : <tr><td className="px-3 py-4 text-slate-500">{empty}</td></tr>}</tbody>
      </table>
    </section>
  );

  return (
    <Page title="Queue" actions={<button className="btn" disabled={runNow.isPending} onClick={() => runNow.mutate()}>{runNow.isPending ? 'Running…' : 'Send due now & check replies'}</button>}>
      <div className="mb-4 space-y-2">
        <Alert kind="info">Scheduled emails go out automatically every few minutes, even when this page is closed. Follow-ups are drafted for you to approve on <Link className="underline" to="/review">Review</Link>.</Alert>
        {(act.error || runNow.error) && <Alert>{errMsg(act.error ?? runNow.error)}</Alert>}
      </div>
      <div className="space-y-4">
        {table('Scheduled', scheduled, (m) => <button className="btn" onClick={() => act.mutate({ path: `/messages/${m.id}/unschedule` })}>Unschedule</button>, 'No emails are scheduled.')}
        {failed.length > 0 && table('Failed', failed, (m) => (
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => act.mutate({ path: `/messages/${m.id}/retry` })}>Retry</button>
            <button className="btn btn-danger" onClick={() => act.mutate({ path: `/messages/${m.id}`, method: 'PATCH', json: { status: 'dismissed' } })}>Dismiss</button>
          </div>
        ))}
        {table('Sent', sent)}
      </div>
    </Page>
  );
}
