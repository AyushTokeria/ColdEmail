import type { IndustryKey } from '../types';

export interface Industry {
  key: IndustryKey;
  label: string;
  defaultAsk: string;
  guidance: string;
}

export const INDUSTRIES: Record<IndustryKey, Industry> = {
  ib: {
    key: 'ib',
    label: 'Investment banking',
    defaultAsk: 'a 15-minute call to hear about their path and their group',
    guidance: `Audience: investment bankers (analyst to MD). They are busy and read email on a phone, so be brief and humble.
- Ask for a short call or coffee chat to learn about their path, their group (coverage or product) and the team. Never ask for a job or referral in a first email.
- If the contact's group or coverage area is known, reference it in a way that shows you have done basic homework (one clause, not a paragraph).
- Mention one concrete thing from the sender's background that explains the interest in banking (a relevant internship, club, class or deal exposure), but only if it appears in the sender's profile.
- Tone: polite, direct, no hype. Do not use words like "passionate", "excited to leverage", or "synergy".`,
  },
  pe: {
    key: 'pe',
    label: 'Private equity',
    defaultAsk: 'a short call to learn how they approach the role and what the firm looks for',
    guidance: `Audience: private equity professionals (associate to partner). They tend to be former bankers or consultants and value precision.
- Ask for a short call to learn about their path from banking or consulting into PE, and how their firm approaches investing.
- Reference any deal or investing exposure from the sender's profile (a transaction, a case competition, an investment club) using its real specifics, never invented ones.
- If the firm's strategy (sector focus, fund size, buyout vs growth) is not given in the contact's data, do NOT guess it.
- Tone: concise and professional. Show curiosity about how they think, not enthusiasm about the industry.`,
  },
  consulting: {
    key: 'consulting',
    label: 'Consulting',
    defaultAsk: 'a short call to hear about their experience at the firm and the work they do',
    guidance: `Audience: consultants (consultant to partner) at strategy and management firms.
- Ask for a short call to hear about their experience: the type of projects, the office, and what the firm values in applicants. Do not ask for a referral in the first email.
- If an office or practice area is in the contact's data, reference it. Otherwise stay general.
- Highlight one structured, problem-solving type of experience from the sender's profile (a case competition, a project, a leadership role) in a single clause.
- Tone: warm, structured and clear. Consultants are good at spotting vague writing, so be specific.`,
  },
  st: {
    key: 'st',
    label: 'Sales & trading',
    defaultAsk: 'a short call to learn about their desk and what a typical day looks like',
    guidance: `Audience: sales and trading professionals (analyst to MD). Culture is fast, direct and personable.
- Ask for a short call to hear what their desk does (asset class or product, sales vs trading) and what a day looks like.
- If the sender's profile mentions markets exposure (a trading club, a personal portfolio, a markets internship, a stock-pitch competition), reference it briefly and specifically. Do not invent market views.
- Keep it shorter than other industries: 3 to 4 sentences before the ask is plenty.
- Tone: confident but not arrogant, conversational, no jargon for jargon's sake.`,
  },
  quant: {
    key: 'quant',
    label: 'Quant',
    defaultAsk: 'a short call to learn about their work and what the firm looks for in new grads or interns',
    guidance: `Audience: quantitative researchers, traders and developers at trading firms, hedge funds and banks.
- Ask for a short call to learn about their role (research, trading or dev), the kind of problems they work on, and what the firm looks for in interns or new grads.
- Be specific and technical about the sender's background where the profile allows (a research project, competition, relevant coursework, languages, results). Prefer concrete facts to adjectives.
- Do not claim knowledge of the firm's strategies. Keep the ask low-pressure.
- Tone: precise, understated, and intellectually curious. Skip flattery.`,
  },
};

export const INDUSTRY_LIST = Object.values(INDUSTRIES);
