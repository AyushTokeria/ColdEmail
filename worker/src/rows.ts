/** Row <-> API shape helpers. */

export interface ContactRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  firm: string;
  role: string;
  group_name: string;
  location: string;
  industry: string;
  education: string;
  experience: string;
  raw_text: string;
  source: string;
  pasted_at: string | null;
  stale: number;
  status: string;
  notes: string;
  score: number;
  coffee_chat_at: string | null;
  created_at: string;
  updated_at: string;
}

const parseArr = (s: string): unknown[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function contactOut(r: ContactRow & { top_connection?: unknown; msg_status?: unknown }) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    firm: r.firm,
    role: r.role,
    group: r.group_name,
    location: r.location,
    industry: r.industry,
    education: parseArr(r.education),
    experience: parseArr(r.experience),
    rawText: r.raw_text,
    source: r.source,
    pastedAt: r.pasted_at,
    stale: !!r.stale,
    status: r.status,
    notes: r.notes,
    score: r.score,
    coffeeChatAt: r.coffee_chat_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...('top_connection' in r ? { topConnection: r.top_connection ?? null } : {}),
    ...('msg_status' in r ? { lastMessageStatus: r.msg_status ?? null } : {}),
  };
}

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.slice(0, 50) : []);

/** Whitelist + normalise incoming contact JSON into column values. */
export function contactIn(b: Record<string, unknown>) {
  return {
    first_name: str(b.firstName, 100),
    last_name: str(b.lastName, 100),
    email: str(b.email, 200).toLowerCase(),
    firm: str(b.firm, 200),
    role: str(b.role, 200),
    group_name: str(b.group, 200),
    location: str(b.location, 200),
    industry: str(b.industry, 50),
    education: arr(b.education),
    experience: arr(b.experience),
    raw_text: str(b.rawText, 30000),
    source: ['form', 'csv', 'linkedin'].includes(b.source as string) ? (b.source as string) : 'form',
    pasted_at: b.source === 'linkedin' ? new Date().toISOString() : null,
    stale: b.stale ? 1 : 0,
    notes: str(b.notes, 5000),
  };
}

export const messageOut = (r: any) => ({
  id: r.id,
  contactId: r.contact_id,
  batchId: r.batch_id,
  step: r.step,
  subject: r.subject,
  body: r.body,
  status: r.status,
  scheduledFor: r.scheduled_for,
  sentAt: r.sent_at,
  threadId: r.thread_id,
  error: r.error,
  createdAt: r.created_at,
  ...('first_name' in r ? { contactName: `${r.first_name} ${r.last_name}`.trim(), firm: r.firm, email: r.email } : {}),
});

export const batchOut = (r: any) => ({
  id: r.id,
  name: r.name,
  industry: r.industry,
  ask: r.ask,
  instructions: r.instructions,
  windowDays: JSON.parse(r.window_days as string),
  windowStart: r.window_start,
  windowEnd: r.window_end,
  timezone: r.timezone,
  dailyCap: r.daily_cap,
  attachResume: !!r.attach_resume,
  createdAt: r.created_at,
});
