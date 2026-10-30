CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}',
  resume_file_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  b64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  firm TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  education TEXT NOT NULL DEFAULT '[]',
  experience TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'form',
  pasted_at TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  coffee_chat_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX contacts_email_uq ON contacts (lower(email)) WHERE email <> '';

CREATE TABLE commonalities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 1,
  evidence TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'local',
  selected INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX commonalities_contact ON commonalities (contact_id);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  ask TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  window_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  window_start INTEGER NOT NULL DEFAULT 9,
  window_end INTEGER NOT NULL DEFAULT 17,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  daily_cap INTEGER NOT NULL DEFAULT 25,
  attach_resume INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  step INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  sent_at TEXT,
  gmail_id TEXT,
  thread_id TEXT,
  rfc_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX messages_contact ON messages (contact_id);
CREATE INDEX messages_due ON messages (status, scheduled_for);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token TEXT,
  access_expires_at TEXT
);
