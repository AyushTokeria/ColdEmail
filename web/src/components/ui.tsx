import { useState, type ReactNode } from 'react';
import { STATUS_LABEL, type ContactStatus } from '../types';

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  const c = { error: 'border-red-200 bg-red-50 text-red-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', ok: 'border-green-200 bg-green-50 text-green-800', info: 'border-sky-200 bg-sky-50 text-sky-900' }[kind];
  return <div className={`rounded-md border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

const STATUS_COLOR: Record<ContactStatus, string> = {
  new: 'bg-slate-100 text-slate-700',
  drafted: 'bg-sky-100 text-sky-800',
  scheduled: 'bg-indigo-100 text-indigo-800',
  contacted: 'bg-amber-100 text-amber-900',
  replied: 'bg-green-100 text-green-800',
  coffee_chat: 'bg-emerald-200 text-emerald-900',
  closed: 'bg-slate-200 text-slate-600',
  bounced: 'bg-red-100 text-red-800',
  do_not_contact: 'bg-red-100 text-red-800',
};

export const StatusBadge = ({ status }: { status: ContactStatus }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status] ?? STATUS_COLOR.new}`}>{STATUS_LABEL[status] ?? status}</span>
);

export function CopyButton({ text, label = 'Copy', primary }: { text: string; label?: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`btn ${primary ? 'btn-primary' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) =>
  iso ? new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleString(undefined, opts) : '';

export const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  return (
    <div className="rounded-md border border-slate-300 bg-white p-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((v) => (
          <span key={v} className="chip gap-1">
            {v}
            <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}
