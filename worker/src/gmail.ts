import { decrypt } from './crypto';
import { buildMime } from './mime';
import type { Env } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';

export class GmailError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function getAccessToken(env: Env): Promise<{ token: string; email: string }> {
  const row = await env.DB.prepare('SELECT * FROM oauth_tokens WHERE id = 1').first<{
    email: string;
    refresh_token_enc: string;
    access_token: string | null;
    access_expires_at: string | null;
  }>();
  if (!row) throw new GmailError('Gmail is not connected', 401);
  if (row.access_token && row.access_expires_at && Date.parse(row.access_expires_at) > Date.now() + 60_000) {
    return { token: row.access_token, email: row.email };
  }
  const refresh = await decrypt(env.TOKEN_ENC_KEY, row.refresh_token_enc);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new GmailError(`Token refresh failed: ${json.error ?? res.status}`, 401);
  }
  await env.DB.prepare('UPDATE oauth_tokens SET access_token = ?, access_expires_at = ? WHERE id = 1')
    .bind(json.access_token, new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString())
    .run();
  return { token: json.access_token, email: row.email };
}

export interface SendArgs {
  token: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  attachment?: { filename: string; mime: string; b64: string } | null;
}

/**
 * Sends through the multipart upload endpoint so the Worker never has to base64url-encode
 * the whole message (the attachment is stored pre-encoded; keeps CPU time tiny).
 */
export async function sendMessage(a: SendArgs): Promise<{ id: string; threadId: string }> {
  const raw = buildMime({
    from: a.from,
    to: a.to,
    subject: a.subject,
    body: a.body,
    inReplyTo: a.inReplyTo ?? undefined,
    references: a.inReplyTo ?? undefined,
    attachment: a.attachment ?? undefined,
  });
  const boundary = `cold_${crypto.randomUUID()}`;
  const meta = JSON.stringify(a.threadId ? { threadId: a.threadId } : {});
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--${boundary}--`;
  const res = await fetch(UPLOAD, {
    method: 'POST',
    headers: { authorization: `Bearer ${a.token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new GmailError(`Gmail send failed (${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
  return (await res.json()) as { id: string; threadId: string };
}

async function gget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GmailError(`Gmail GET ${path.split('?')[0]} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

type Header = { name: string; value: string };
const header = (hs: Header[] | undefined, name: string) =>
  hs?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

export async function getRfcMessageId(token: string, gmailId: string): Promise<string | null> {
  const m = await gget<{ payload?: { headers?: Header[] } }>(
    token,
    `/messages/${gmailId}?format=metadata&metadataHeaders=Message-ID`,
  );
  return header(m.payload?.headers, 'Message-ID') || null;
}

export type ThreadState = 'none' | 'replied' | 'bounced';

/** Looks at the From of every message in the thread. */
export async function checkThread(token: string, threadId: string, myEmail: string): Promise<ThreadState> {
  const t = await gget<{ messages?: { payload?: { headers?: Header[] } }[] }>(
    token,
    `/threads/${threadId}?format=metadata&metadataHeaders=From`,
  );
  const me = myEmail.toLowerCase();
  let replied = false;
  for (const m of t.messages ?? []) {
    const from = header(m.payload?.headers, 'From').toLowerCase();
    if (!from || from.includes(me)) continue;
    if (/mailer-daemon|postmaster/.test(from)) return 'bounced';
    replied = true;
  }
  return replied ? 'replied' : 'none';
}
