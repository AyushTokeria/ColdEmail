import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Page } from '../components/ui';
import { STATUS_LABEL, type ContactStatus } from '../types';

interface Row { k: string; contacted: number; replied: number }
interface StatsData {
  byStatus: { status: ContactStatus; n: number }[];
  byIndustry: Row[];
  byFirm: Row[];
  byCommonality: Row[];
  emailsSent: number;
}

function Table({ title, rows, label }: { title: string; rows: Row[]; label: (k: string) => string }) {
  return (
    <section className="card p-0">
      <h2 className="border-b px-3 py-2 font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-1.5">Group</th><th className="px-3 py-1.5">Contacted</th><th className="px-3 py-1.5">Replied</th><th className="px-3 py-1.5">Rate</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t">
              <td className="px-3 py-1.5">{label(r.k) || '(none)'}</td>
              <td className="px-3 py-1.5">{r.contacted}</td>
              <td className="px-3 py-1.5">{r.replied ?? 0}</td>
              <td className="px-3 py-1.5">{r.contacted ? Math.round(((r.replied ?? 0) / r.contacted) * 100) : 0}%</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-slate-500">Nothing sent yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

export default function Stats() {
  const { data } = useQuery({ queryKey: ['stats'], queryFn: () => api<StatsData>('/stats') });
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const count = (s: ContactStatus) => data.byStatus.find((x) => x.status === s)?.n ?? 0;
  const contacted = count('contacted') + count('replied') + count('coffee_chat') + count('closed');
  const replies = count('replied') + count('coffee_chat');
  const tiles: [string, string | number][] = [
    ['Emails sent', data.emailsSent],
    ['People contacted', contacted],
    ['Replies', replies],
    ['Reply rate', contacted ? `${Math.round((replies / contacted) * 100)}%` : '–'],
    ['Coffee chats', count('coffee_chat')],
  ];
  return (
    <Page title="Stats">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="card text-center"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-slate-500">{k}</div></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Table title="By industry" rows={data.byIndustry} label={(k) => k.toUpperCase()} />
        <Table title="By firm" rows={data.byFirm} label={(k) => k} />
        <Table title="By type of connection" rows={data.byCommonality} label={(k) => k.replace('_', ' ')} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Statuses: {data.byStatus.map((s) => `${STATUS_LABEL[s.status]} ${s.n}`).join(' · ') || 'no contacts yet'}</p>
    </Page>
  );
}
