export interface Env {
  DB: D1Database;
  FRONTEND_URL: string;
  FRONTEND_ORIGIN: string;
  ALLOWED_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENC_KEY: string;
}

export type AppEnv = { Bindings: Env };

export const CONTACT_STATUSES = [
  'new',
  'drafted',
  'scheduled',
  'contacted',
  'replied',
  'coffee_chat',
  'closed',
  'bounced',
  'do_not_contact',
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const MESSAGE_STATUSES = ['draft', 'approved', 'scheduled', 'sent', 'failed', 'dismissed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
