import type { Batch, Commonality, Contact, ProfileData } from '../types';
import { INDUSTRIES } from './industries';

const FOOTER = 'Reply with ONLY one ```json code block and nothing else (no commentary before or after).';

export const CHUNK_SIZE = 10;

export function chunk<T>(xs: T[], n = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Rough size hint so the user knows a prompt will fit in a chat message. */
export const tokenEstimate = (s: string) => Math.ceil(s.length / 4);

export function extractProfilePrompt(typed: ProfileData): string {
  return `I am recruiting for finance and consulting roles. My resume is attached to this message. Read it and extract my background into the JSON format below. Use ONLY facts that appear in the resume or in "What I typed in". Do not guess. Use "" or [] for anything missing.

What I typed in (may be empty; it takes priority over the resume if they differ):
${JSON.stringify(typed, null, 2)}

JSON format:
{
  "name": "Full name",
  "schools": ["Main university first, then any other colleges"],
  "gradYear": "2027",
  "major": "Finance",
  "highSchool": "Name of high school if listed",
  "hometown": "City, State/Country if listed",
  "languages": ["Languages I speak, e.g. Hindi"],
  "experiences": [{ "org": "Company or organization", "role": "My title", "detail": "One short factual sentence" }],
  "activities": [{ "name": "Club, team or organization", "kind": "club | sport | other" }],
  "interests": ["Hobbies or interests"]
}

${FOOTER}`;
}

export function parseLinkedInPrompt(items: { id: number | string; text: string }[], todayIso = new Date().toISOString().slice(0, 10)): string {
  const blocks = items.map((i) => `=== PROFILE id=${i.id} ===\n${i.text.trim()}\n=== END ===`).join('\n\n');
  return `Below are ${items.length} LinkedIn profile text(s) that were copy-pasted from the website, so they can contain page clutter ("Connect", "Message", mutual connections, etc.). Extract the facts for each one into the JSON format below. Use ONLY information present in the text; use "" or [] when something is missing. Do not guess email addresses.

Today's date is ${todayIso}. Set "currentRoleEnded" to true if the most recent job in the experience list has an end date that is before today (the profile may be out of date). Set "hasDates" to false if the experience entries have no dates at all.

${blocks}

JSON format:
{
  "contacts": [
    {
      "id": "the id from the profile header, copied exactly",
      "firstName": "", "lastName": "",
      "firm": "Current employer",
      "role": "Current title",
      "group": "Group, desk, practice or team if stated",
      "location": "City, Region",
      "education": [{ "school": "", "degree": "", "field": "", "years": "" }],
      "experience": [{ "org": "", "title": "", "start": "", "end": "" }],
      "currentRoleEnded": false,
      "hasDates": true
    }
  ]
}

${FOOTER}`;
}

export interface DraftContact {
  contact: Contact;
  commonalities: Commonality[];
}

const brief = (c: Contact) => ({
  firstName: c.firstName,
  lastName: c.lastName,
  firm: c.firm,
  role: c.role,
  group: c.group,
  location: c.location,
  education: c.education,
  experience: c.experience.slice(0, 6),
});

export function draftBatchPrompt(profile: ProfileData, batch: Pick<Batch, 'industry' | 'ask' | 'instructions'>, items: DraftContact[], redoNote?: string): string {
  const ind = INDUSTRIES[batch.industry];
  const sender = {
    name: profile.name,
    schools: profile.schools,
    gradYear: profile.gradYear,
    major: profile.major,
    highSchool: profile.highSchool,
    hometown: profile.hometown,
    languages: profile.languages,
    experiences: profile.experiences,
    activities: profile.activities,
    interests: profile.interests,
  };
  const people = items.map(({ contact, commonalities }) => {
    const shared = commonalities.filter((x) => x.selected).map((x) => ({ detail: x.detail, evidence: x.evidence }));
    return `--- CONTACT id=${contact.id} ---
${JSON.stringify(brief(contact))}
Shared connections already found (strongest first): ${JSON.stringify(shared)}
${contact.notes ? `The sender's own notes about this contact (trusted): ${contact.notes}\n` : ''}${contact.rawText ? `Their pasted LinkedIn text (for finding additional overlaps):\n"""\n${contact.rawText.slice(0, 4000)}\n"""` : '(no pasted profile text)'}`;
  });
  const ask = batch.ask.trim() || ind.defaultAsk;
  return `You are helping a student write short, genuine first-contact emails to professionals in ${ind.label.toLowerCase()}. Write one email per contact below.

ABOUT THE SENDER (the only facts you may state about them):
${JSON.stringify(sender, null, 2)}

THE ASK (exactly one, near the end): ${ask}

INDUSTRY GUIDANCE
${ind.guidance}

RULES FOR EVERY EMAIL
1. Body is 60 to 110 words, plain text, no markdown, no bullet points. Subject is at most 8 words, specific, not clickbait.
2. Greeting is "Hi <firstName>,". Sign off with the sender's name${profile.signature ? ` using this signature:\n${profile.signature}` : ''}.
3. Open with the strongest shared connection, stated naturally in the first one or two sentences (for example a shared high school, hometown, university, language, club, or past employer). If there is no shared connection, open with one specific, honest reason for reaching out based on their role or firm. Never flatter.
4. Use ONLY facts given above. Never invent experiences, deals, numbers, mutual contacts, or details about the contact or their firm. If you are unsure about something, leave it out.
5. You may add extra overlaps ONLY if the contact's pasted text clearly shows them. For each, give a short verbatim quote from the text (at most 12 words) as "evidence".
6. Do not use em dashes or en dashes. Avoid "I hope this email finds you well", "passionate", "leverage", "synergy", "pick your brain".
7. Do not attach or mention an attachment unless it says to; the resume is attached automatically, so one brief mention such as "I've attached my resume" is fine.
${batch.instructions.trim() ? `8. Extra instructions from the sender: ${batch.instructions.trim()}\n` : ''}${redoNote ? `\nREDO NOTE from the sender (follow this): ${redoNote}\n` : ''}
CONTACTS
${people.join('\n\n')}

JSON format:
{
  "drafts": [
    {
      "contactId": 12,
      "subject": "",
      "body": "",
      "connectionsUsed": ["copy the exact 'detail' text of each shared connection you used"],
      "extraConnections": [{ "type": "high_school | hometown | university | employer | language | club | sport | other", "detail": "", "strength": 1, "evidence": "short verbatim quote" }]
    }
  ]
}
"contactId" must be copied exactly from each CONTACT header. Return one draft for every contact.

${FOOTER}`;
}
