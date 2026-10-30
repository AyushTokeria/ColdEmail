import { z } from 'zod';
import type { Commonality, CommonalityType, Contact } from '../types';
import { findPhrase } from './match';

/** Pulls the first JSON value out of a pasted chat reply (fenced block, or bare). */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) candidates.push(m[1].trim());
  const bare = balanced(text);
  if (bare) candidates.push(bare);
  if (candidates.length === 0) return { ok: false, error: 'No JSON found. Paste the whole reply, including the code block.' };

  let lastErr = '';
  for (const c of candidates) {
    for (const attempt of [c, repair(c)]) {
      try {
        return { ok: true, value: JSON.parse(attempt) };
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
  }
  return { ok: false, error: `The JSON could not be read (${lastErr}). Ask Claude to "reply again with only valid JSON".` };
}

function repair(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

/** First balanced {...} or [...] in the text, respecting strings. */
function balanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const str = z.string().trim();
const optStr = z.string().trim().nullish().transform((v) => v ?? '');
const strArr = z.array(z.string().trim()).nullish().transform((v) => (v ?? []).filter(Boolean));

export const ProfileResult = z.object({
  name: optStr,
  schools: strArr,
  gradYear: optStr,
  major: optStr,
  highSchool: optStr,
  hometown: optStr,
  languages: strArr,
  experiences: z
    .array(z.object({ org: str, role: optStr, detail: optStr }))
    .nullish()
    .transform((v) => v ?? []),
  activities: z
    .array(z.object({ name: str, kind: z.enum(['club', 'sport', 'other']).catch('other') }))
    .nullish()
    .transform((v) => v ?? []),
  interests: strArr,
});

export const LinkedInResult = z.object({
  contacts: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      firstName: optStr,
      lastName: optStr,
      firm: optStr,
      role: optStr,
      group: optStr,
      location: optStr,
      education: z
        .array(z.object({ school: str, degree: optStr, field: optStr, years: optStr }))
        .nullish()
        .transform((v) => v ?? []),
      experience: z
        .array(z.object({ org: str, title: optStr, start: optStr, end: optStr }))
        .nullish()
        .transform((v) => v ?? []),
      currentRoleEnded: z.boolean().nullish().transform((v) => !!v),
      hasDates: z.boolean().nullish().transform((v) => v !== false),
    }),
  ),
});

const COMMON_TYPES = ['high_school', 'hometown', 'university', 'employer', 'language', 'club', 'sport', 'other'] as const;

export const DraftResult = z.object({
  drafts: z.array(
    z.object({
      contactId: z.union([z.string(), z.number()]).transform(Number),
      subject: str,
      body: str,
      connectionsUsed: strArr,
      extraConnections: z
        .array(
          z.object({
            type: z.enum(COMMON_TYPES).catch('other'),
            detail: str,
            strength: z.coerce.number().catch(1),
            evidence: optStr,
          }),
        )
        .nullish()
        .transform((v) => v ?? []),
    }),
  ),
});

export function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  return `Unexpected format at "${i.path.join('.') || 'root'}": ${i.message}`;
}

export function parseWith<T extends z.ZodType>(schema: T, text: string): { ok: true; value: z.output<T> } | { ok: false; error: string } {
  const j = extractJson(text);
  if (!j.ok) return j;
  // allow the model to answer with a bare array for convenience
  let v = j.value;
  const r = schema.safeParse(v);
  if (r.success) return { ok: true, value: r.data };
  if (Array.isArray(v)) {
    const wrapped = schema.safeParse({ contacts: v, drafts: v });
    if (wrapped.success) return { ok: true, value: wrapped.data };
  }
  return { ok: false, error: zodMessage(r.error) };
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export interface DraftCheck {
  level: 'error' | 'warn';
  message: string;
}

/** Sanity checks shown beside each pasted draft. Errors block approval in the UI; warnings don't. */
export function checkDraft(
  d: z.output<typeof DraftResult>['drafts'][number],
  contact: Pick<Contact, 'email' | 'rawText'>,
  known: Pick<Commonality, 'detail'>[],
): DraftCheck[] {
  const out: DraftCheck[] = [];
  const words = wordCount(d.body);
  if (words > 170) out.push({ level: 'error', message: `Too long (${words} words). Aim for under 120.` });
  else if (words > 130) out.push({ level: 'warn', message: `A bit long (${words} words).` });
  if (/\{\{|\}\}|\[(name|firm|company|your)[^\]]*\]/i.test(d.subject + d.body)) out.push({ level: 'error', message: 'Contains leftover placeholder text.' });
  if (!contact.email) out.push({ level: 'warn', message: 'This contact has no email address yet.' });
  if (/[—–]/.test(d.body)) out.push({ level: 'warn', message: 'Contains dashes (— or –), a common AI tell. Consider rewording.' });
  if (d.connectionsUsed.length === 0) out.push({ level: 'warn', message: 'No shared connection was used.' });

  const all = [...known.map((k) => k.detail), ...d.extraConnections.map((e) => e.detail)].map((s) => s.toLowerCase());
  for (const u of d.connectionsUsed) {
    if (!all.includes(u.toLowerCase())) out.push({ level: 'warn', message: `Cites a connection that was not provided: "${u}". Verify it is true.` });
  }
  for (const e of d.extraConnections) {
    if (contact.rawText && e.evidence && !findPhrase(contact.rawText.replace(/\s+/g, ' '), e.evidence.slice(0, 60))) {
      out.push({ level: 'warn', message: `Could not find the evidence for "${e.detail}" in the pasted profile text.` });
    }
  }
  return out;
}

export const toCommonality = (e: { type: CommonalityType; detail: string; strength: number; evidence: string }): Commonality => ({
  type: e.type,
  detail: e.detail,
  strength: Math.min(3, Math.max(1, Math.round(e.strength) || 1)),
  evidence: e.evidence,
  origin: 'claude',
  selected: true,
});
