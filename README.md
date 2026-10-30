# ColdEmails

A free, personal cold-email tool for finance, consulting and quant recruiting, inspired by [Mapped](https://mpped.com).

You give it your resume and a list of contacts (form, CSV, or pasted LinkedIn text). It finds what you have in common with each person, helps Claude write a short email that opens with the best connection, lets you review every draft, sends from your own Gmail at random times in the hours you choose, drafts follow-ups in the same thread, and tracks replies in a pipeline.

**Cost: $0.** There is no paid AI API. The app builds a prompt, you paste it into [claude.ai](https://claude.ai) (free plan) and paste the reply back. Everything else runs on free tiers.

| Part | Where | Free tier |
|---|---|---|
| Web app (`web/`) | GitHub Pages (**public repo**) | Free |
| API + scheduler (`worker/`) | Cloudflare Workers + D1 + Cron | Free, no card |
| Sending and reply detection | Gmail API (your own account) | Free |

## How it works

1. **Profile**: upload your resume, run the "fill from resume" prompt in claude.ai, review the result.
2. **Contacts**: add by form, CSV, or paste LinkedIn profiles. A matcher in the browser instantly scores shared school, high school, hometown, employer, language and activities, citing evidence.
3. **New drafts**: pick contacts, an industry (IB, PE, consulting, S&T, quant) and the ask. Copy the prompt (up to 10 contacts each) into claude.ai and paste the reply back. Each draft is checked for length, placeholders, dashes and connections that weren't in your data.
4. **Review**: edit, approve, skip, or ask Claude to redo one. Then schedule the approved ones.
5. **Queue**: a Cloudflare cron job (every 5 minutes) sends them at random times inside your window, respecting a daily cap, with your resume attached.
6. **Follow-ups**: after 4 and 8 days with no reply, a template follow-up is drafted in the same thread for you to approve.
7. **Pipeline and stats**: replies are detected from the Gmail thread and the card moves itself.

LinkedIn text is often out of date, so a profile whose latest role has ended (or has no dates) is flagged "may be stale".

## One-time setup

You need a Cloudflare account (free, no card for what this uses), a GitHub account, and a Google account.

### 1. Fork or push this repo to GitHub as a **public** repo
GitHub Free only serves Pages from public repos. Nothing personal is stored in the repo: your email, IDs and secrets go in repo variables and secrets below.

### 2. Cloudflare
```sh
cd worker && npm install
npx wrangler login
npx wrangler d1 create coldemails        # note the database_id it prints
```
Create an API token at *Cloudflare dashboard → My Profile → API Tokens* using the **Edit Cloudflare Workers** template, and note your Account ID (Workers & Pages overview).

Do **not** enable R2 (it asks for a card); the app doesn't use it.

### 3. Google (Gmail API)
1. [Google Cloud Console](https://console.cloud.google.com) → new project → *APIs & Services → Library* → enable **Gmail API**.
2. *OAuth consent screen* → External → fill in the basics → add scopes `gmail.send` and `gmail.readonly` → add yourself as a test user.
3. **Publish the app to "Production"** (button on the consent screen). In *Testing* mode Google expires refresh tokens after 7 days, which would break scheduled sending. For personal use you can ignore the "unverified app" warning when you sign in (Advanced → Go to app).
4. *Credentials → Create OAuth client ID → Web application*. Add the authorized redirect URI:
   `https://coldemails-api.<your-workers-subdomain>.workers.dev/auth/callback`
   (and `http://localhost:8787/auth/callback` for local development).

### 4. GitHub repo settings
*Settings → Pages → Source: GitHub Actions.* Then *Settings → Secrets and variables → Actions*:

| Type | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your account id |
| Secret | `GOOGLE_CLIENT_SECRET` | from the OAuth client |
| Secret | `TOKEN_ENC_KEY` | any long random string (`openssl rand -base64 32`) |
| Variable | `D1_DATABASE_ID` | from `wrangler d1 create` |
| Variable | `GOOGLE_CLIENT_ID` | from the OAuth client |
| Variable | `ALLOWED_EMAIL` | the Gmail address that may sign in (only this account is accepted) |
| Variable | `FRONTEND_URL` | `https://<you>.github.io/<repo>/` |
| Variable | `FRONTEND_ORIGIN` | `https://<you>.github.io` |
| Variable | `API_URL` | `https://coldemails-api.<subdomain>.workers.dev` |

Push to `main`: the two workflows deploy the Worker (applying the D1 migration) and the site. Open the Pages URL and sign in with Google.

## Local development
```sh
# terminal 1: API
cd worker && npm install
echo 'GOOGLE_CLIENT_SECRET=...' >  .dev.vars
echo 'TOKEN_ENC_KEY=any-string'  >> .dev.vars
# set GOOGLE_CLIENT_ID / ALLOWED_EMAIL / FRONTEND_URL=http://localhost:5173/ / FRONTEND_ORIGIN=http://localhost:5173 in wrangler.toml (don't commit them)
npm run db:local && npm run dev          # http://localhost:8787

# terminal 2: web
cd web && npm install && npm run dev     # http://localhost:5173
```
Tests: `npm test` in `worker/` and `web/`.

## Free-tier limits this design respects
- Workers free plan: **10 ms CPU per call**. The browser base64-encodes your resume, and Gmail sends use the multipart upload endpoint, so the Worker never encodes a large file itself.
- **50 outbound fetches and 50 D1 queries per call.** Each cron run sends at most 5 emails and checks at most 15 threads.
- D1 rows max out at 2 MB, so the resume is limited to about 1.4 MB.
- claude.ai free plan has message limits. Prompts are batched 10 contacts at a time to keep within them.

## Sending etiquette
Use this for genuine, personal outreach, review every email, and keep volume reasonable (the default cap is 25 a day). Mass-sending near-identical emails risks Gmail marking you as spam.
