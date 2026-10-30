import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { encrypt, fromB64Url, randomToken, sha256Hex, signState, verifyState } from '../crypto';
import type { AppEnv } from '../types';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const SESSION_DAYS = 30;

export const auth = new Hono<AppEnv>();

auth.get('/login', async (c) => {
  const redirectUri = new URL('/auth/callback', c.req.url).toString();
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    login_hint: c.env.ALLOWED_EMAIL,
    state: await signState(c.env.TOKEN_ENC_KEY),
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

function back(c: { env: AppEnv['Bindings'] }, fragment: string): string {
  const base = c.env.FRONTEND_URL.replace(/#.*$/, '');
  return `${base}#/auth?${fragment}`;
}

auth.get('/callback', async (c) => {
  const q = c.req.query();
  if (q.error) return c.redirect(back(c, `error=${encodeURIComponent(q.error)}`));
  if (!q.code || !q.state || !(await verifyState(c.env.TOKEN_ENC_KEY, q.state))) {
    return c.redirect(back(c, 'error=invalid_state'));
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: q.code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: new URL('/auth/callback', c.req.url).toString(),
      grant_type: 'authorization_code',
    }),
  });
  const tok = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
  };
  if (!res.ok || !tok.access_token || !tok.id_token) return c.redirect(back(c, 'error=token_exchange'));

  // The id_token arrives straight from Google over TLS, so decoding without a signature check is fine.
  const claims = JSON.parse(new TextDecoder().decode(fromB64Url(tok.id_token.split('.')[1]))) as {
    email?: string;
    email_verified?: boolean;
  };
  if (!claims.email_verified || claims.email?.toLowerCase() !== c.env.ALLOWED_EMAIL.toLowerCase()) {
    return c.redirect(back(c, 'error=not_allowed'));
  }
  const scope = tok.scope ?? '';
  if (!scope.includes('gmail.send') || !scope.includes('gmail.readonly')) {
    return c.redirect(back(c, 'error=missing_gmail_scopes'));
  }

  const db = c.env.DB;
  if (tok.refresh_token) {
    await db
      .prepare(
        `INSERT INTO oauth_tokens (id, email, refresh_token_enc, access_token, access_expires_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET email = ?1, refresh_token_enc = ?2, access_token = ?3, access_expires_at = ?4`,
      )
      .bind(
        claims.email,
        await encrypt(c.env.TOKEN_ENC_KEY, tok.refresh_token),
        tok.access_token,
        new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      )
      .run();
  } else {
    const existing = await db.prepare('SELECT 1 FROM oauth_tokens WHERE id = 1').first();
    if (!existing) return c.redirect(back(c, 'error=no_refresh_token'));
  }

  const session = randomToken();
  await db
    .prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)')
    .bind(await sha256Hex(session), new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString())
    .run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return c.redirect(back(c, `token=${session}`));
});

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  if (!m) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare("SELECT 1 AS ok FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(m[1]), new Date().toISOString())
    .first();
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

export const session = new Hono<AppEnv>();
session.get('/me', async (c) => {
  const row = await c.env.DB.prepare('SELECT email FROM oauth_tokens WHERE id = 1').first<{ email: string }>();
  return c.json({ email: row?.email ?? null, gmailConnected: !!row });
});
session.post('/logout', async (c) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  if (m) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(m[1])).run();
  return c.json({ ok: true });
});
