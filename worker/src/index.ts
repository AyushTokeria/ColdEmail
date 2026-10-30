import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runCron } from './cron';
import { api } from './routes/api';
import { auth, requireAuth, session } from './routes/auth';
import type { AppEnv, Env } from './types';

const app = new Hono<AppEnv>();

app.use('*', (c, next) =>
  cors({
    origin: (origin) => {
      if (origin === c.env.FRONTEND_ORIGIN) return origin;
      if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin;
      return null;
    },
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(c, next),
);

app.get('/', (c) => c.text('coldemails api'));
app.route('/auth', auth);
app.use('/api/*', requireAuth);
app.route('/api', session);
app.route('/api', api);

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: 'internal error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runCron(env));
  },
};
