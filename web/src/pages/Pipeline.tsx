import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, fullName } from '../components/ui';
import { useContacts } from '../hooks';
import { STATUS_LABEL, type Contact, type ContactStatus } from '../types';

const COLUMNS: ContactStatus[] = ['new', 'drafted', 'scheduled', 'contacted', 'replied', 'coffee_chat', 'closed'];

export default function Pipeline() {
  const { data: contacts = [] } = useContacts();
  const qc = useQueryClient();
  const [over, setOver] = useState<ContactStatus | null>(null);
  const move = useMutation({
    mutationFn: (v: { id: number; status: ContactStatus }) => api(`/contacts/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['contacts'] });
      const prev = qc.getQueryData<Contact[]>(['contacts']);
      qc.setQueryData<Contact[]>(['contacts'], (old) => old?.map((c) => (c.id === v.id ? { ...c, status: v.status } : c)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['contacts'], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });
  const other = contacts.filter((c) => !COLUMNS.includes(c.status));

  return (
    <Page title="Pipeline">
      <p className="mb-3 text-sm text-slate-600">Drag a card to change its stage. Moving someone to Replied, Coffee chat or Closed cancels their pending follow-ups. Replies are also detected automatically from Gmail.</p>
      <div className="grid auto-cols-[16rem] grid-flow-col gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((col) => {
          const items = contacts.filter((c) => c.status === col);
          return (
            <div
              key={col}
              className={`rounded-lg border p-2 ${over === col ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-100'}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = Number(e.dataTransfer.getData('text/plain'));
                if (id && contacts.find((c) => c.id === id)?.status !== col) move.mutate({ id, status: col });
              }}
            >
              <div className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase text-slate-500">
                <span>{STATUS_LABEL[col]}</span><span>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((c) => (
                  <div key={c.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))} className="cursor-grab rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm active:cursor-grabbing">
                    <Link className="font-medium text-indigo-700 hover:underline" to={`/contacts/${c.id}`}>{fullName(c)}</Link>
                    <div className="text-xs text-slate-500">{[c.role, c.firm].filter(Boolean).join(' · ')}</div>
                    {c.coffeeChatAt && <div className="mt-1 text-xs text-emerald-700">☕ {new Date(c.coffeeChatAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {other.length > 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Not in the board: {other.map((c) => `${fullName(c)} (${STATUS_LABEL[c.status]})`).join(', ')}
        </p>
      )}
    </Page>
  );
}
