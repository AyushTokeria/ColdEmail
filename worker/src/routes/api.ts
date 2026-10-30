import { Hono } from 'hono';
import { runCron, loadFollowupSettings } from '../cron';
import { getAccessToken } from '../gmail';
import { batchOut, contactIn, contactOut, messageOut, type ContactRow } from '../rows';
import { assignSlots, dayKey } from '../schedule';
import { DEFAULT_FOLLOWUPS } from '../templates';
import { CONTACT_STATUSES, type AppEnv } from '../types';

export const api = new Hono<AppEnv>();

const MAX_RESUME_B64 = 1_900_000;
const COMMON_TYPES = ['high_school', 'hometown', 'university', 'employer', 'language', 'club', 'sport', 'other'];

async function json(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------- profile ----------
api.get('/profile', async (c) => {
  const p = await c.env.DB.prepare('SELECT data, resume_file_id FROM profile WHERE id = 1').first<{ data: string; resume_file_id: string | null }>();
  const file = p?.resume_file_id
    ? await c.env.DB.prepare('SELECT id, filename, size FROM files WHERE id = ?').bind(p.resume_file_id).first()
    : null;
  return c.json({ data: p ? JSON.parse(p.data) : {}, resume: file ?? null });
});

api.put('/profile', async (c) => {
  const b = await json(c);
  const data = JSON.stringify(b.data ?? {});
  if (data.length > 100_000) return c.json({ error: 'profile too large' }, 413);
  await c.env.DB.prepare(
    `INSERT INTO profile (id, data) VALUES (1, ?1)
     ON CONFLICT(id) DO UPDATE SET data = ?1, updated_at = datetime('now')`,
  ).bind(data).run();
  return c.json({ ok: true });
});

// Body is the raw base64 text of the PDF (encoded in the browser; the Worker has a 10 ms CPU budget).
api.put('/profile/resume', async (c) => {
  const filename = (c.req.query('filename') ?? 'resume.pdf').replace(/[^\w.\- ()]/g, '_').slice(0, 100);
  const b64 = (await c.req.text()).replace(/\s+/g, '');
  if (!b64.startsWith('JVBER')) return c.json({ error: 'Only PDF files are supported' }, 400); // "%PDF-" in base64
  if (b64.length > MAX_RESUME_B64) return c.json({ error: 'Resume too large (max ~1.4 MB PDF)' }, 413);
  const wrapped = b64.replace(/(.{76})/g, '$1\r\n');
  const id = crypto.randomUUID();
  const old = await c.env.DB.prepare('SELECT resume_file_id FROM profile WHERE id = 1').first<{ resume_file_id: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO files (id, filename, mime, size, b64) VALUES (?, ?, ?, ?, ?)').bind(id, filename, 'application/pdf', Math.floor((b64.length * 3) / 4), wrapped),
    c.env.DB.prepare(
      `INSERT INTO profile (id, resume_file_id) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET resume_file_id = ?1, updated_at = datetime('now')`,
    ).bind(id),
    ...(old?.resume_file_id ? [c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(old.resume_file_id)] : []),
  ]);
  return c.json({ id, filename });
});

api.delete('/profile/resume', async (c) => {
  const old = await c.env.DB.prepare('SELECT resume_file_id FROM profile WHERE id = 1').first<{ resume_file_id: string | null }>();
  if (old?.resume_file_id) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE profile SET resume_file_id = NULL WHERE id = 1'),
      c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(old.resume_file_id),
    ]);
  }
  return c.json({ ok: true });
});

// ---------- contacts ----------
const CONTACT_COLS = 'first_name,last_name,email,firm,role,group_name,location,industry,education,experience,raw_text,source,pasted_at,stale,notes';

function insertContact(c: { env: AppEnv['Bindings'] }, v: ReturnType<typeof contactIn>, ignoreDup: boolean) {
  const vals = Object.values(v);
  return c.env.DB.prepare(
    `INSERT ${ignoreDup ? 'OR IGNORE ' : ''}INTO contacts (${CONTACT_COLS}) VALUES (${vals.map(() => '?').join(',')})`,
  ).bind(...vals);
}

api.get('/contacts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
            (SELECT detail FROM commonalities WHERE contact_id = c.id AND selected = 1 ORDER BY strength DESC, id LIMIT 1) AS top_connection,
            (SELECT status FROM messages WHERE contact_id = c.id ORDER BY step DESC, id DESC LIMIT 1) AS msg_status
       FROM contacts c ORDER BY c.score DESC, c.id DESC`,
  ).all<ContactRow & { top_connection: string | null; msg_status: string | null }>();
  return c.json(results.map(contactOut));
});

api.post('/contacts', async (c) => {
  const v = contactIn(await json(c));
  if (!v.first_name && !v.last_name) return c.json({ error: 'name is required' }, 400);
  try {
    const r = await insertContact(c, v, false).run();
    return c.json({ id: r.meta.last_row_id });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'A contact with that email already exists' }, 409);
    throw e;
  }
});

api.post('/contacts/bulk', async (c) => {
  const b = await json(c);
  const list = Array.isArray(b.contacts) ? (b.contacts as Record<string, unknown>[]).slice(0, 200) : [];
  const rows = list.map(contactIn).filter((v) => v.first_name || v.last_name);
  if (rows.length === 0) return c.json({ inserted: 0, skipped: 0, ids: [] });
  const res = await c.env.DB.batch(rows.map((v) => insertContact(c, v, true)));
  const ids = res.map((r) => (r.meta.changes ? r.meta.last_row_id : null));
  return c.json({ inserted: ids.filter(Boolean).length, skipped: ids.filter((i) => !i).length, ids });
});

api.get('/contacts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first<ContactRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const [com, msgs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM commonalities WHERE contact_id = ? ORDER BY strength DESC, id').bind(id),
    c.env.DB.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY step, id').bind(id),
  ]);
  return c.json({
    ...contactOut(row),
    commonalities: com.results.map((r: any) => ({ id: r.id, type: r.type, detail: r.detail, strength: r.strength, evidence: r.evidence, origin: r.origin, selected: !!r.selected })),
    messages: msgs.results.map(messageOut),
  });
});

api.patch('/contacts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await json(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('status' in b) {
    if (!CONTACT_STATUSES.includes(b.status as never)) return c.json({ error: 'bad status' }, 400);
    sets.push('status = ?');
    vals.push(b.status);
  }
  if ('coffeeChatAt' in b) {
    sets.push('coffee_chat_at = ?');
    vals.push(typeof b.coffeeChatAt === 'string' && b.coffeeChatAt ? b.coffeeChatAt : null);
  }
  const full = contactIn(b);
  const map: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', email: 'email', firm: 'firm', role: 'role', group: 'group_name', location: 'location', industry: 'industry', education: 'education', experience: 'experience', notes: 'notes', stale: 'stale' };
  for (const [k, col] of Object.entries(map)) {
    if (k in b) {
      sets.push(`${col} = ?`);
      vals.push((full as Record<string, unknown>)[col]);
    }
  }
  if (sets.length === 0) return c.json({ ok: true });
  try {
    await c.env.DB.prepare(`UPDATE contacts SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, id).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'A contact with that email already exists' }, 409);
    throw e;
  }
  // Closing out a contact stops any pending sends to them.
  if (['do_not_contact', 'closed', 'replied', 'coffee_chat'].includes(b.status as string)) {
    await c.env.DB.prepare(`UPDATE messages SET status = 'dismissed' WHERE contact_id = ? AND status IN ('draft','approved','scheduled')`).bind(id).run();
  }
  return c.json({ ok: true });
});

api.delete('/contacts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---------- commonalities ----------
/** Replaces all commonalities of one origin for a contact, then recomputes the contact's score. */
api.put('/contacts/:id/commonalities', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await json(c);
  const origin = b.origin === 'claude' ? 'claude' : b.origin === 'manual' ? 'manual' : 'local';
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30) as Record<string, unknown>[];
  const stmts = [c.env.DB.prepare('DELETE FROM commonalities WHERE contact_id = ? AND origin = ?').bind(id, origin)];
  for (const it of items) {
    const detail = typeof it.detail === 'string' ? it.detail.trim().slice(0, 300) : '';
    if (!detail) continue;
    stmts.push(
      c.env.DB.prepare('INSERT INTO commonalities (contact_id, type, detail, strength, evidence, origin, selected) VALUES (?,?,?,?,?,?,?)').bind(
        id,
        COMMON_TYPES.includes(it.type as string) ? it.type : 'other',
        detail,
        Math.min(3, Math.max(1, Math.round(Number(it.strength) || 1))),
        typeof it.evidence === 'string' ? it.evidence.slice(0, 500) : '',
        origin,
        it.selected === false ? 0 : 1,
      ),
    );
  }
  stmts.push(rescore(c.env.DB, id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

api.patch('/commonalities/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await json(c);
  const row = await c.env.DB.prepare('SELECT contact_id FROM commonalities WHERE id = ?').bind(id).first<{ contact_id: number }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await c.env.DB.batch([c.env.DB.prepare('UPDATE commonalities SET selected = ? WHERE id = ?').bind(b.selected ? 1 : 0, id), rescore(c.env.DB, row.contact_id)]);
  return c.json({ ok: true });
});

const rescore = (db: D1Database, contactId: number) =>
  db.prepare('UPDATE contacts SET score = COALESCE((SELECT SUM(strength) FROM commonalities WHERE contact_id = ?1 AND selected = 1), 0) WHERE id = ?1').bind(contactId);

// ---------- batches ----------
function batchIn(b: Record<string, unknown>) {
  const days = Array.isArray(b.windowDays) ? (b.windowDays as number[]).filter((d) => d >= 1 && d <= 7) : [1, 2, 3, 4, 5];
  const start = Math.min(23, Math.max(0, Number(b.windowStart ?? 9)));
  const end = Math.min(24, Math.max(start + 1, Number(b.windowEnd ?? 17)));
  const tz = typeof b.timezone === 'string' ? b.timezone : 'America/New_York';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error('Unknown timezone');
  }
  return {
    name: String(b.name ?? '').trim().slice(0, 100) || 'Batch',
    industry: String(b.industry ?? '').slice(0, 50),
    ask: String(b.ask ?? '').slice(0, 500),
    instructions: String(b.instructions ?? '').slice(0, 2000),
    window_days: JSON.stringify(days.length ? days : [1, 2, 3, 4, 5]),
    window_start: start,
    window_end: end,
    timezone: tz,
    daily_cap: Math.min(100, Math.max(1, Number(b.dailyCap ?? 25))),
    attach_resume: b.attachResume === false ? 0 : 1,
  };
}

api.get('/batches', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM batches ORDER BY id DESC').all();
  return c.json(results.map(batchOut));
});

api.post('/batches', async (c) => {
  let v;
  try {
    v = batchIn(await json(c));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const cols = Object.keys(v);
  const r = await c.env.DB.prepare(`INSERT INTO batches (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...Object.values(v)).run();
  return c.json({ id: r.meta.last_row_id });
});

api.patch('/batches/:id', async (c) => {
  let v;
  try {
    v = batchIn(await json(c));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const cols = Object.keys(v);
  await c.env.DB.prepare(`UPDATE batches SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(v), Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---------- messages ----------
api.get('/messages', async (c) => {
  const status = c.req.query('status');
  const step = c.req.query('step');
  const where: string[] = [];
  const vals: unknown[] = [];
  if (status) {
    where.push(`m.status IN (${status.split(',').map(() => '?').join(',')})`);
    vals.push(...status.split(','));
  }
  if (step !== undefined) {
    where.push('m.step = ?');
    vals.push(Number(step));
  }
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, c.first_name, c.last_name, c.firm, c.email FROM messages m JOIN contacts c ON c.id = m.contact_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(m.scheduled_for, m.created_at) DESC LIMIT 500`,
  ).bind(...vals).all();
  return c.json(results.map(messageOut));
});

/** Saves pasted drafts as new step-0 messages (replacing any unsent draft for the same contact). */
api.post('/messages/bulk', async (c) => {
  const b = await json(c);
  const batchId = Number(b.batchId) || null;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50) as Record<string, unknown>[];
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const contactId = Number(it.contactId);
    const subject = String(it.subject ?? '').trim().slice(0, 300);
    const body = String(it.body ?? '').trim().slice(0, 10000);
    if (!contactId || !subject || !body) continue;
    stmts.push(
      c.env.DB.prepare(`DELETE FROM messages WHERE contact_id = ? AND step = 0 AND status IN ('draft','approved')`).bind(contactId),
      c.env.DB.prepare('INSERT INTO messages (contact_id, batch_id, step, subject, body) VALUES (?,?,0,?,?)').bind(contactId, batchId, subject, body),
      c.env.DB.prepare(`UPDATE contacts SET status = 'drafted', updated_at = datetime('now') WHERE id = ? AND status = 'new'`).bind(contactId),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ saved: stmts.length / 3 });
});

api.patch('/messages/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await json(c);
  const cur = await c.env.DB.prepare('SELECT m.status, m.body, m.subject, c.email FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.id = ?')
    .bind(id)
    .first<{ status: string; body: string; subject: string; email: string }>();
  if (!cur) return c.json({ error: 'not found' }, 404);
  if (['sent', 'failed'].includes(cur.status) && !('status' in b && b.status === 'dismissed')) return c.json({ error: 'message already sent' }, 409);

  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 300) : cur.subject;
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 10000) : cur.body;
  let status = cur.status;
  if (typeof b.status === 'string') {
    if (!['draft', 'approved', 'dismissed'].includes(b.status)) return c.json({ error: 'bad status' }, 400);
    status = b.status;
  } else if (cur.status === 'approved' || cur.status === 'scheduled') {
    status = 'draft'; // editing text invalidates approval
  }
  if (status === 'approved') {
    if (!cur.email) return c.json({ error: 'Add an email address for this contact before approving' }, 400);
    if (!subject || !body) return c.json({ error: 'Subject and body are required' }, 400);
    if (/\{\{|\}\}|\[(name|firm|company)\]/i.test(subject + body)) return c.json({ error: 'Remove the leftover placeholder text first' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE messages SET subject = ?, body = ?, status = ?, scheduled_for = CASE WHEN ? = 'scheduled' THEN scheduled_for ELSE NULL END WHERE id = ?`,
  ).bind(subject, body, status, status, id).run();
  return c.json({ ok: true, status });
});

api.delete('/messages/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM messages WHERE id = ? AND status NOT IN ('sent')`).bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/** Assigns random send times to approved messages, per batch window and daily cap. */
api.post('/messages/schedule', async (c) => {
  const b = await json(c);
  const ids = (Array.isArray(b.messageIds) ? b.messageIds : []).map(Number).filter(Boolean).slice(0, 200);
  if (ids.length === 0) return c.json({ error: 'No messages selected' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.batch_id, m.contact_id FROM messages m WHERE m.status = 'approved' AND m.id IN (${ids.map(() => '?').join(',')}) ORDER BY m.step, m.id`,
  ).bind(...ids).all<{ id: number; batch_id: number | null; contact_id: number }>();
  if (results.length === 0) return c.json({ error: 'Approve the drafts first' }, 400);

  const byBatch = new Map<number, number[]>();
  const msgContacts = new Map<number, number>();
  for (const r of results) {
    const key = r.batch_id ?? 0;
    byBatch.set(key, [...(byBatch.get(key) ?? []), r.id]);
    msgContacts.set(r.id, r.contact_id);
  }

  const stmts: D1PreparedStatement[] = [];
  const out: { id: number; scheduledFor: string }[] = [];
  const now = Date.now();
  // Cap is global per local day, counting everything already scheduled or sent.
  const existing = await c.env.DB.prepare(`SELECT scheduled_for, sent_at FROM messages WHERE status IN ('scheduled','sent')`).all<{ scheduled_for: string | null; sent_at: string | null }>();
  for (const [batchId, msgIds] of byBatch) {
    const bt = batchId ? await c.env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(batchId).first<any>() : null;
    const window = { days: bt ? JSON.parse(bt.window_days) : [1, 2, 3, 4, 5], startHour: bt?.window_start ?? 9, endHour: bt?.window_end ?? 17, timezone: bt?.timezone ?? 'America/New_York' };
    const perDay: Record<string, number> = {};
    for (const e of existing.results) {
      const t = Date.parse(e.sent_at ?? e.scheduled_for ?? '');
      if (!Number.isNaN(t)) perDay[dayKey(t, window.timezone)] = (perDay[dayKey(t, window.timezone)] ?? 0) + 1;
    }
    let slots: number[];
    try {
      slots = assignSlots({ count: msgIds.length, now, window, dailyCap: bt?.daily_cap ?? 25, existingPerDay: perDay });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    // Shuffle so the order of contacts isn't the order of the list.
    const order = [...msgIds].sort(() => Math.random() - 0.5);
    order.forEach((id, i) => {
      const iso = new Date(slots[i]).toISOString();
      out.push({ id, scheduledFor: iso });
      stmts.push(
        c.env.DB.prepare(`UPDATE messages SET status = 'scheduled', scheduled_for = ?, attempts = 0, error = NULL WHERE id = ?`).bind(iso, id),
        c.env.DB.prepare(`UPDATE contacts SET status = 'scheduled' WHERE id = ? AND status IN ('new','drafted')`).bind(msgContacts.get(id)),
      );
    });
  }
  await c.env.DB.batch(stmts);
  return c.json({ scheduled: out.length, messages: out });
});

api.post('/messages/:id/unschedule', async (c) => {
  await c.env.DB.prepare(`UPDATE messages SET status = 'approved', scheduled_for = NULL WHERE id = ? AND status = 'scheduled'`).bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

api.post('/messages/:id/retry', async (c) => {
  await c.env.DB.prepare(`UPDATE messages SET status = 'scheduled', scheduled_for = ?, attempts = 0, error = NULL WHERE id = ? AND status = 'failed'`)
    .bind(new Date(Date.now() + 60_000).toISOString(), Number(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

// ---------- settings / stats / misc ----------
api.get('/settings/followups', async (c) => c.json(await loadFollowupSettings(c.env)));
api.put('/settings/followups', async (c) => {
  const b = await json(c);
  const days = Array.isArray(b.days) ? b.days.map(Number) : DEFAULT_FOLLOWUPS.days;
  const t = (b.templates ?? {}) as Record<string, unknown>;
  const clean = (v: unknown, fallback: string[]) => (Array.isArray(v) ? v.map((s) => String(s).slice(0, 3000)).filter(Boolean).slice(0, 5) : fallback);
  const value: typeof DEFAULT_FOLLOWUPS = {
    days: [Math.max(1, days[0] || 4), Math.max(2, days[1] || 8)],
    templates: { step1: clean(t.step1, DEFAULT_FOLLOWUPS.templates.step1), step2: clean(t.step2, DEFAULT_FOLLOWUPS.templates.step2) },
  };
  if (!value.templates.step1.length) value.templates.step1 = DEFAULT_FOLLOWUPS.templates.step1;
  if (!value.templates.step2.length) value.templates.step2 = DEFAULT_FOLLOWUPS.templates.step2;
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('followups', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(value)).run();
  return c.json(value);
});

api.get('/stats', async (c) => {
  const db = c.env.DB;
  const [byStatus, byIndustry, byFirm, byType] = await db.batch([
    db.prepare('SELECT status, COUNT(*) AS n FROM contacts GROUP BY status'),
    db.prepare(`SELECT industry AS k, COUNT(*) AS contacted, SUM(status IN ('replied','coffee_chat')) AS replied FROM contacts WHERE status IN ('contacted','replied','coffee_chat','closed') GROUP BY industry`),
    db.prepare(`SELECT firm AS k, COUNT(*) AS contacted, SUM(status IN ('replied','coffee_chat')) AS replied FROM contacts WHERE status IN ('contacted','replied','coffee_chat','closed') AND firm <> '' GROUP BY firm ORDER BY contacted DESC LIMIT 15`),
    db.prepare(`SELECT cm.type AS k, COUNT(DISTINCT c.id) AS contacted, COUNT(DISTINCT CASE WHEN c.status IN ('replied','coffee_chat') THEN c.id END) AS replied
                  FROM commonalities cm JOIN contacts c ON c.id = cm.contact_id
                 WHERE cm.selected = 1 AND c.status IN ('contacted','replied','coffee_chat','closed') GROUP BY cm.type`),
  ]);
  const sent = await db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE status = 'sent'`).first<{ n: number }>();
  return c.json({ byStatus: byStatus.results, byIndustry: byIndustry.results, byFirm: byFirm.results, byCommonality: byType.results, emailsSent: sent?.n ?? 0 });
});

api.post('/cron/run', async (c) => {
  await runCron(c.env);
  return c.json({ ok: true });
});

api.get('/gmail/status', async (c) => {
  try {
    const { email } = await getAccessToken(c.env);
    return c.json({ connected: true, email });
  } catch (e) {
    return c.json({ connected: false, error: (e as Error).message });
  }
});
