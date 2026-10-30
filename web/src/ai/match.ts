import type { Commonality, Contact, ProfileData } from '../types';

/** Words that don't help tell two institutions apart. */
const STOP = new Set([
  'the', 'of', 'at', 'and', 'in', 'for', 'a', 'university', 'college', 'school', 'institute', 'business', 'management',
  'graduate', 'undergraduate', 'inc', 'llc', 'corp', 'corporation', 'company', 'co', 'group', 'ltd', 'lp', 'partners',
  'high', 'academy', 'prep', 'preparatory', 'secondary', 'senior', 'junior', 'public', 'private',
]);

/** Common abbreviations written as one token. Expanded before comparing. */
const ALIAS: Record<string, string> = {
  nyu: 'new york',
  upenn: 'pennsylvania',
  penn: 'pennsylvania',
  wharton: 'pennsylvania',
  ucla: 'california los angeles',
  usc: 'southern california',
  unc: 'north carolina',
  uva: 'virginia',
  cmu: 'carnegie mellon',
  bu: 'boston',
  bc: 'boston',
  gs: 'goldman sachs',
  jpm: 'jpmorgan',
  jpmorgan: 'jp morgan',
  ms: 'morgan stanley',
  bofa: 'bank america',
  mckinsey: 'mckinsey',
  bcg: 'boston consulting',
};

export function tokens(s: string): Set<string> {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  const out = new Set<string>();
  for (const w of base.split(/\s+/)) {
    if (!w) continue;
    for (const piece of (ALIAS[w] ?? w).split(' ')) if (piece && !STOP.has(piece)) out.add(piece);
  }
  return out;
}

/**
 * Two names refer to the same institution when their distinctive tokens are identical,
 * or when the smaller set (≥2 tokens) is fully contained in the larger one.
 * "Michigan" vs "Michigan State" deliberately does NOT match.
 */
export function sameEntity(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return false;
  const inter = [...A].filter((t) => B.has(t)).length;
  if (inter === A.size && inter === B.size) return true;
  const min = Math.min(A.size, B.size);
  return min >= 2 && inter === min;
}

/** Whole-phrase search inside free text. Returns a short snippet for evidence. */
export function findPhrase(text: string, phrase: string): string | null {
  const p = phrase.trim();
  if (p.length < 3 || !text) return null;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  if (!m) return null;
  const at = m.index + m[1].length;
  const start = Math.max(0, at - 40);
  return text.slice(start, Math.min(text.length, at + p.length + 40)).replace(/\s+/g, ' ').trim();
}

const city = (s: string) => s.split(',')[0].trim();

export function findCommonalities(profile: ProfileData, c: Pick<Contact, 'education' | 'experience' | 'firm' | 'location' | 'rawText' | 'role'>): Commonality[] {
  const out: Commonality[] = [];
  const add = (x: Omit<Commonality, 'origin' | 'selected'>) => {
    if (!out.some((o) => o.type === x.type && o.detail.toLowerCase() === x.detail.toLowerCase())) out.push({ ...x, origin: 'local', selected: true });
  };
  const raw = c.rawText ?? '';

  // Schools: high school (rare, strong) vs university
  for (const ed of c.education ?? []) {
    if (!ed.school) continue;
    if (profile.highSchool && sameEntity(profile.highSchool, ed.school)) {
      add({ type: 'high_school', detail: `Both attended ${ed.school}`, strength: 3, evidence: `Education: ${ed.school}` });
      continue;
    }
    for (const s of profile.schools ?? []) {
      if (sameEntity(s, ed.school)) {
        add({ type: 'university', detail: `Both attended ${ed.school}`, strength: 2, evidence: `Education: ${[ed.school, ed.degree, ed.field].filter(Boolean).join(', ')}` });
        break;
      }
    }
  }
  // High school mentioned in raw text only (e.g. LinkedIn "About")
  if (profile.highSchool && !out.some((o) => o.type === 'high_school')) {
    const hit = findPhrase(raw, profile.highSchool);
    if (hit) add({ type: 'high_school', detail: `Both connected to ${profile.highSchool}`, strength: 3, evidence: hit });
  }

  // Employers: the contact's current firm or any past one vs. the sender's experiences
  const orgs = [c.firm, ...(c.experience ?? []).map((e) => e.org)].filter(Boolean);
  for (const e of profile.experiences ?? []) {
    if (!e.org) continue;
    const hit = orgs.find((o) => sameEntity(o, e.org));
    if (hit) add({ type: 'employer', detail: `You worked at ${e.org}${e.role ? ` (${e.role})` : ''}; they ${hit === c.firm ? 'work' : 'worked'} at ${hit}`, strength: 2, evidence: `Experience: ${hit}` });
  }

  // Hometown
  if (profile.hometown) {
    const h = city(profile.hometown);
    const hit = findPhrase(raw, h);
    if (hit) add({ type: 'hometown', detail: `Connected to ${profile.hometown}`, strength: 3, evidence: hit });
    else if (c.location && findPhrase(c.location, h)) add({ type: 'hometown', detail: `Based in ${h}, your hometown`, strength: 1, evidence: `Location: ${c.location}` });
  }

  // Languages
  for (const l of profile.languages ?? []) {
    const hit = findPhrase(raw, l);
    if (hit) add({ type: 'language', detail: `Both speak ${l}`, strength: 2, evidence: hit });
  }

  // Activities and interests in free text
  for (const a of profile.activities ?? []) {
    const hit = findPhrase(raw, a.name);
    if (hit) add({ type: a.kind === 'sport' ? 'sport' : a.kind === 'club' ? 'club' : 'other', detail: `Both involved in ${a.name}`, strength: 2, evidence: hit });
  }
  for (const i of profile.interests ?? []) {
    const hit = findPhrase(raw, i);
    if (hit) add({ type: 'other', detail: `Shared interest: ${i}`, strength: 1, evidence: hit });
  }

  return out.sort((a, b) => b.strength - a.strength);
}

export const scoreOf = (cs: Pick<Commonality, 'strength' | 'selected'>[]) => cs.filter((c) => c.selected).reduce((n, c) => n + c.strength, 0);
