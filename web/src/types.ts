export type IndustryKey = 'ib' | 'pe' | 'consulting' | 'st' | 'quant';

export interface Activity {
  name: string;
  kind: 'club' | 'sport' | 'other';
}

export interface ProfileData {
  name?: string;
  schools?: string[]; // first = main school
  gradYear?: string;
  major?: string;
  highSchool?: string;
  hometown?: string;
  languages?: string[];
  experiences?: { org: string; role?: string; detail?: string }[];
  activities?: Activity[];
  interests?: string[];
  targetIndustries?: IndustryKey[];
  signature?: string;
}

export type CommonalityType = 'high_school' | 'hometown' | 'university' | 'employer' | 'language' | 'club' | 'sport' | 'other';

export interface Commonality {
  id?: number;
  type: CommonalityType;
  detail: string;
  strength: number;
  evidence: string;
  origin: 'local' | 'claude' | 'manual';
  selected: boolean;
}

export interface Education {
  school: string;
  degree?: string;
  field?: string;
  years?: string;
}
export interface Experience {
  org: string;
  title?: string;
  start?: string;
  end?: string;
}

export const CONTACT_STATUSES = ['new', 'drafted', 'scheduled', 'contacted', 'replied', 'coffee_chat', 'closed', 'bounced', 'do_not_contact'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  firm: string;
  role: string;
  group: string;
  location: string;
  industry: string;
  education: Education[];
  experience: Experience[];
  rawText: string;
  source: 'form' | 'csv' | 'linkedin';
  pastedAt: string | null;
  stale: boolean;
  status: ContactStatus;
  notes: string;
  score: number;
  coffeeChatAt: string | null;
  topConnection?: string | null;
  lastMessageStatus?: string | null;
}

export interface ContactDetail extends Contact {
  commonalities: Commonality[];
  messages: Message[];
}

export interface Message {
  id: number;
  contactId: number;
  batchId: number | null;
  step: number;
  subject: string;
  body: string;
  status: 'draft' | 'approved' | 'scheduled' | 'sent' | 'failed' | 'dismissed';
  scheduledFor: string | null;
  sentAt: string | null;
  error: string | null;
  contactName?: string;
  firm?: string;
  email?: string;
}

export interface Batch {
  id: number;
  name: string;
  industry: IndustryKey;
  ask: string;
  instructions: string;
  windowDays: number[];
  windowStart: number;
  windowEnd: number;
  timezone: string;
  dailyCap: number;
  attachResume: boolean;
}

export const STATUS_LABEL: Record<ContactStatus, string> = {
  new: 'New',
  drafted: 'Drafted',
  scheduled: 'Scheduled',
  contacted: 'Contacted',
  replied: 'Replied',
  coffee_chat: 'Coffee chat',
  closed: 'Closed',
  bounced: 'Bounced',
  do_not_contact: 'Do not contact',
};
