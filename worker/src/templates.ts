export interface FollowupSettings {
  /** days after the first email at which follow-ups 1 and 2 are drafted */
  days: [number, number];
  templates: { step1: string[]; step2: string[] };
}

export const DEFAULT_FOLLOWUPS: FollowupSettings = {
  days: [4, 8],
  templates: {
    step1: [
      `Hi {firstName},\n\nI wanted to follow up on my note below. I know things get busy at {firm}, so no worries if the timing is off. Even 15 minutes would mean a lot, and I'm happy to work around your schedule.\n\nThank you,\n{senderFirstName}`,
      `Hi {firstName},\n\nJust bumping this to the top of your inbox in case it got buried. I'd really value a quick chat about your path at {firm}, whenever suits you.\n\nBest,\n{senderFirstName}`,
    ],
    step2: [
      `Hi {firstName},\n\nOne last follow-up from me. If now isn't a good time, I completely understand, and I'll stay in touch. If you do have 15 minutes in the next couple of weeks, I'd be grateful.\n\nThank you,\n{senderFirstName}`,
    ],
  },
};

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}
