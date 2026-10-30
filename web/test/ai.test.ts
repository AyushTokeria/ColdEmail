import { describe, expect, it } from 'vitest';
import { findCommonalities, sameEntity } from '../src/ai/match';
import { DraftResult, LinkedInResult, ProfileResult, checkDraft, extractJson, parseWith, wordCount } from '../src/ai/parse';
import { chunk, draftBatchPrompt, parseLinkedInPrompt } from '../src/ai/prompts';
import type { Contact, ProfileData } from '../src/types';

describe('sameEntity', () => {
  it('matches abbreviations and subsets', () => {
    expect(sameEntity('NYU', 'New York University')).toBe(true);
    expect(sameEntity('NYU Stern', 'New York University Stern School of Business')).toBe(true);
    expect(sameEntity('Goldman Sachs', 'Goldman Sachs & Co.')).toBe(true);
    expect(sameEntity('JPMorgan', 'JP Morgan Chase')).toBe(true);
  });
  it('does not confuse different institutions', () => {
    expect(sameEntity('University of Michigan', 'Michigan State University')).toBe(false);
    expect(sameEntity('University of Pennsylvania', 'Penn State')).toBe(false);
    expect(sameEntity('Columbia University', 'Colombia')).toBe(false);
    expect(sameEntity('', 'Stuyvesant')).toBe(false);
  });
});

const profile: ProfileData = {
  name: 'Ayush T',
  schools: ['New York University'],
  highSchool: 'Stuyvesant High School',
  hometown: 'Mumbai, India',
  languages: ['Hindi'],
  experiences: [{ org: 'Morgan Stanley', role: 'Summer Analyst' }],
  activities: [
    { name: 'Rugby', kind: 'sport' },
    { name: 'Alpha Kappa Psi', kind: 'club' },
  ],
  interests: ['chess'],
};

describe('findCommonalities', () => {
  it('finds school, high school, employer, language, and activities with evidence', () => {
    const r = findCommonalities(profile, {
      firm: 'Evercore',
      role: 'Analyst',
      location: 'New York, NY',
      education: [
        { school: 'Stuyvesant High School' },
        { school: 'NYU Stern School of Business', degree: 'BS' },
      ],
      experience: [{ org: 'Morgan Stanley', title: 'Intern' }],
      rawText: 'Fluent in Hindi and English. Captain of the Rugby team. Born and raised in Mumbai.',
    });
    const types = r.map((x) => x.type);
    expect(types).toEqual(expect.arrayContaining(['high_school', 'university', 'employer', 'language', 'sport', 'hometown']));
    expect(r[0].strength).toBe(3);
    expect(r.find((x) => x.type === 'hometown')!.evidence).toMatch(/Mumbai/);
    expect(types).not.toContain('club');
  });

  it('only uses a location hit as a weak hometown signal', () => {
    const r = findCommonalities(profile, { firm: 'X', role: '', location: 'Mumbai, India', education: [], experience: [], rawText: '' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'hometown', strength: 1 });
  });

  it('returns nothing for unrelated people', () => {
    expect(findCommonalities(profile, { firm: 'Citi', role: '', location: 'London', education: [{ school: 'Oxford' }], experience: [], rawText: 'Likes golf' })).toEqual([]);
  });
});

describe('extractJson', () => {
  it('reads a fenced block surrounded by prose', () => {
    const r = extractJson('Sure! Here you go:\n```json\n{"a": 1}\n```\nHope that helps');
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });
  it('reads bare JSON and repairs smart quotes and trailing commas', () => {
    expect(extractJson('{"a": [1,2,],}')).toEqual({ ok: true, value: { a: [1, 2] } });
    expect(extractJson('{“a”: “b”}')).toEqual({ ok: true, value: { a: 'b' } });
  });
  it('is not fooled by braces inside strings', () => {
    expect(extractJson('x {"t": "a } b"} y')).toEqual({ ok: true, value: { t: 'a } b' } });
  });
  it('reports a clear error', () => {
    expect(extractJson('no json here').ok).toBe(false);
    expect(extractJson('```json\n{oops\n```').ok).toBe(false);
  });
});

describe('schemas', () => {
  it('normalises a profile reply with nulls', () => {
    const r = parseWith(ProfileResult, '```json\n{"name":"A","schools":["NYU"],"highSchool":null,"activities":[{"name":"Rugby","kind":"weird"}]}\n```');
    expect(r.ok && r.value).toMatchObject({ name: 'A', highSchool: '', languages: [], activities: [{ name: 'Rugby', kind: 'other' }] });
  });
  it('accepts a bare array for contacts and numeric ids', () => {
    const r = parseWith(LinkedInResult, '[{"id": 5, "firstName": "J"}]');
    expect(r.ok && r.value.contacts[0]).toMatchObject({ id: '5', firstName: 'J', hasDates: true, currentRoleEnded: false });
  });
  it('rejects the wrong shape with a path in the message', () => {
    const r = parseWith(DraftResult, '{"drafts":[{"contactId":1,"subject":"s"}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/drafts\.0\.body/);
  });
});

describe('checkDraft', () => {
  const base = { contactId: 1, subject: 'Hi', body: 'Hi Jane, we both went to Stuyvesant. Could we chat?', connectionsUsed: ['Both attended Stuyvesant'], extraConnections: [] };
  const known = [{ detail: 'Both attended Stuyvesant' }];
  it('passes a clean draft', () => {
    expect(checkDraft(base, { email: 'a@b.com', rawText: '' }, known)).toEqual([]);
  });
  it('flags length, placeholders, dashes, missing email and unknown connections', () => {
    const long = Array(200).fill('word').join(' ');
    const msgs = checkDraft({ ...base, body: `Hi {{name}} — ${long}`, connectionsUsed: ['Both ran the NYC marathon'] }, { email: '', rawText: '' }, known);
    const text = msgs.map((m) => m.message).join(' | ');
    expect(msgs.some((m) => m.level === 'error' && /Too long/.test(m.message))).toBe(true);
    expect(text).toMatch(/placeholder/);
    expect(text).toMatch(/dashes/);
    expect(text).toMatch(/no email/);
    expect(text).toMatch(/not provided/);
  });
  it('warns when an extra connection has no evidence in the pasted text', () => {
    const d = { ...base, connectionsUsed: ['Both play chess'], extraConnections: [{ type: 'other' as const, detail: 'Both play chess', strength: 1, evidence: 'plays chess competitively' }] };
    expect(checkDraft(d, { email: 'a@b', rawText: 'Enjoys golf' }, known).some((m) => /evidence/.test(m.message))).toBe(true);
    expect(checkDraft(d, { email: 'a@b', rawText: 'He plays chess competitively on weekends' }, known)).toEqual([]);
  });
});

describe('prompts', () => {
  const c = { id: 12, firstName: 'Jane', lastName: 'Doe', firm: 'Evercore', role: 'Analyst', group: '', location: '', education: [], experience: [], rawText: 'Plays chess' } as unknown as Contact;
  it('includes ids, industry guidance, rules and the JSON footer', () => {
    const p = draftBatchPrompt(profile, { industry: 'ib', ask: '', instructions: '' }, [{ contact: c, commonalities: [{ type: 'high_school', detail: 'Both attended Stuyvesant', strength: 3, evidence: '', origin: 'local', selected: true }] }]);
    expect(p).toContain('CONTACT id=12');
    expect(p).toContain('Investment banking'.toLowerCase());
    expect(p).toContain('Both attended Stuyvesant');
    expect(p).toContain('Never invent');
    expect(p).toMatch(/ONLY one ```json/);
  });
  it('wraps LinkedIn text per id', () => {
    const p = parseLinkedInPrompt([{ id: 3, text: 'Jane Doe\nAnalyst' }], '2026-10-30');
    expect(p).toContain('=== PROFILE id=3 ===');
    expect(p).toContain('2026-10-30');
  });
  it('chunks lists', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(wordCount(' a b  c ')).toBe(3);
  });
});
