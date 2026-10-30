import { checkThread, getAccessToken, getRfcMessageId, sendMessage, type ThreadState } from './gmail';
import { DEFAULT_FOLLOWUPS, pick, renderTemplate, type FollowupSettings } from './templates';
import type { Env } from './types';

const MAX_SENDS_PER_RUN = 5;
const MAX_THREAD_CHECKS_PER_RUN = 15;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

export async function loadFollowupSettings(env: Env): Promise<FollowupSettings> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'followups'").first<{ value: string }>();
  if (!row) return DEFAULT_FOLLOWUPS;
  try {
    return { ...DEFAULT_FOLLOWUPS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_FOLLOWUPS;
  }
}

/** Entry point for the Cron Trigger. Each step is isolated so one failure doesn't block the rest. */
export async function runCron(env: Env): Promise<void> {
  for (const step of [sendDue, checkReplies, draftFollowups]) {
    try {
      await step(env);
    } catch (e) {
      console.error(`cron step ${step.name} failed:`, e);
    }
  }
}

interface DueRow {
  id: number;
  contact_id: number;
  batch_id: number | null;
  step: number;
  subject: string;
  body: string;
  attempts: number;
  email: string;
  attach_resume: number | null;
  resume_file_id: string | null;
}

export async function sendDue(env: Env): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT m.id, m.contact_id, m.batch_id, m.step, m.subject, m.body, m.attempts, c.email,
            b.attach_resume, (SELECT resume_file_id FROM profile WHERE id = 1) AS resume_file_id
       FROM messages m
       JOIN contacts c ON c.id = m.contact_id
       LEFT JOIN batches b ON b.id = m.batch_id
      WHERE m.status = 'scheduled' AND m.scheduled_for <= ?
        AND c.status NOT IN ('replied','bounced','do_not_contact','closed')
      ORDER BY m.scheduled_for LIMIT ?`,
  )
    .bind(new Date().toISOString(), MAX_SENDS_PER_RUN)
    .all<DueRow>();
  if (due.results.length === 0) return;

  const { token, email: me } = await getAccessToken(env);
  let attachment: { filename: string; mime: string; b64: string } | null = null;
  const needsResume = due.results.some((r) => r.attach_resume && r.step === 0 && r.resume_file_id);
  if (needsResume) {
    const f = await env.DB.prepare('SELECT filename, mime, b64 FROM files WHERE id = ?')
      .bind(due.results[0].resume_file_id)
      .first<{ filename: string; mime: string; b64: string }>();
    attachment = f ?? null;
  }

  for (const m of due.results) {
    try {
      let threadId: string | null = null;
      let inReplyTo: string | null = null;
      if (m.step > 0) {
        const first = await env.DB.prepare(
          'SELECT thread_id, rfc_message_id FROM messages WHERE contact_id = ? AND step = 0 AND status = ? LIMIT 1',
        )
          .bind(m.contact_id, 'sent')
          .first<{ thread_id: string; rfc_message_id: string | null }>();
        threadId = first?.thread_id ?? null;
        inReplyTo = first?.rfc_message_id ?? null;
      }
      const sent = await sendMessage({
        token,
        from: me,
        to: m.email,
        subject: m.subject,
        body: m.body,
        threadId,
        inReplyTo,
        attachment: m.step === 0 && m.attach_resume ? attachment : null,
      });
      let rfc: string | null = null;
      try {
        rfc = await getRfcMessageId(token, sent.id);
      } catch {
        // threading headers are best-effort
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE messages SET status = 'sent', sent_at = ?, gmail_id = ?, thread_id = ?, rfc_message_id = ?, error = NULL WHERE id = ?`,
        ).bind(new Date().toISOString(), sent.id, sent.threadId, rfc, m.id),
        env.DB.prepare(
          `UPDATE contacts SET status = CASE WHEN status IN ('new','drafted','scheduled') THEN 'contacted' ELSE status END,
                               updated_at = datetime('now') WHERE id = ?`,
        ).bind(m.contact_id),
      ]);
    } catch (e) {
      const attempts = m.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      // back off 10 / 20 minutes before the next try
      const retryAt = new Date(Date.now() + attempts * 10 * 60_000).toISOString();
      await env.DB.prepare(
        `UPDATE messages SET attempts = ?, error = ?, status = ?, scheduled_for = ? WHERE id = ?`,
      )
        .bind(attempts, String(e instanceof Error ? e.message : e).slice(0, 500), failed ? 'failed' : 'scheduled', retryAt, m.id)
        .run();
    }
  }
}

export async function checkReplies(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT c.id AS contact_id, m.thread_id
       FROM contacts c
       JOIN messages m ON m.contact_id = c.id AND m.step = 0 AND m.status = 'sent' AND m.thread_id IS NOT NULL
      WHERE c.status IN ('contacted','scheduled')
      ORDER BY COALESCE(c.last_checked_at, '') LIMIT ?`,
  )
    .bind(MAX_THREAD_CHECKS_PER_RUN)
    .all<{ contact_id: number; thread_id: string }>();
  if (rows.results.length === 0) return;

  const { token, email } = await getAccessToken(env);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows.results) {
    let state: ThreadState = 'none';
    try {
      state = await checkThread(token, r.thread_id, email);
    } catch (e) {
      console.error('thread check failed', r.thread_id, e);
      continue;
    }
    if (state === 'none') {
      stmts.push(env.DB.prepare('UPDATE contacts SET last_checked_at = ? WHERE id = ?').bind(now, r.contact_id));
    } else {
      const status = state === 'replied' ? 'replied' : 'bounced';
      stmts.push(
        env.DB.prepare(`UPDATE contacts SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`).bind(status, now, now, r.contact_id),
        env.DB.prepare(
          `UPDATE messages SET status = 'dismissed' WHERE contact_id = ? AND step > 0 AND status IN ('draft','approved','scheduled')`,
        ).bind(r.contact_id),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** Drafts template follow-ups for contacts still in `contacted`; the user approves them in the app. */
export async function draftFollowups(env: Env): Promise<void> {
  const settings = await loadFollowupSettings(env);
  const profile = await env.DB.prepare('SELECT data FROM profile WHERE id = 1').first<{ data: string }>();
  const senderFirst = (JSON.parse(profile?.data ?? '{}').name ?? '').split(' ')[0] || '';

  const rows = await env.DB.prepare(
    `SELECT c.id, c.first_name, c.firm, m0.batch_id, m0.subject, m0.sent_at,
            (SELECT detail FROM commonalities WHERE contact_id = c.id AND selected = 1 ORDER BY strength DESC LIMIT 1) AS connection
       FROM contacts c
       JOIN messages m0 ON m0.contact_id = c.id AND m0.step = 0 AND m0.status = 'sent'
      WHERE c.status = 'contacted'`,
  ).all<{ id: number; first_name: string; firm: string; batch_id: number | null; subject: string; sent_at: string; connection: string | null }>();

  const stmts: D1PreparedStatement[] = [];
  const now = Date.now();
  for (const c of rows.results) {
    const age = now - Date.parse(c.sent_at);
    const steps = await env.DB.prepare('SELECT step, status FROM messages WHERE contact_id = ? AND step > 0').bind(c.id).all<{ step: number; status: string }>();
    const has = (step: number, ...st: string[]) => steps.results.some((s) => s.step === step && st.includes(s.status));
    const vars = { firstName: c.first_name, firm: c.firm, connection: c.connection ?? '', senderFirstName: senderFirst };
    const subject = /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`;

    if (age >= settings.days[1] * DAY && !has(2, 'draft', 'approved', 'scheduled', 'sent', 'dismissed')) {
      // second follow-up replaces an unsent first one
      stmts.push(env.DB.prepare(`DELETE FROM messages WHERE contact_id = ? AND step = 1 AND status = 'draft'`).bind(c.id));
      if (!has(2, 'sent')) {
        stmts.push(
          env.DB.prepare(`INSERT INTO messages (contact_id, batch_id, step, subject, body) VALUES (?, ?, 2, ?, ?)`).bind(
            c.id, c.batch_id, subject, renderTemplate(pick(settings.templates.step2, c.id), vars),
          ),
        );
      }
    } else if (age >= settings.days[0] * DAY && age < settings.days[1] * DAY && !has(1, 'draft', 'approved', 'scheduled', 'sent', 'dismissed')) {
      stmts.push(
        env.DB.prepare(`INSERT INTO messages (contact_id, batch_id, step, subject, body) VALUES (?, ?, 1, ?, ?)`).bind(
          c.id, c.batch_id, subject, renderTemplate(pick(settings.templates.step1, c.id), vars),
        ),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}
