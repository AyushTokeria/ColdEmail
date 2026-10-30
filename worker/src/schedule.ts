/** Pure scheduling helpers: send windows in an IANA timezone, random slots with a daily cap. */

export interface SendWindow {
  /** ISO weekdays, 1 = Monday … 7 = Sunday */
  days: number[];
  /** local hours, window is [startHour, endHour) */
  startHour: number;
  endHour: number;
  timezone: string;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as unknown as LocalParts;
}

/** Offset (ms) of `tz` from UTC at instant `ms`. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a wall-clock time in `tz` (handles DST by re-checking the offset). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

export function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function dayKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface SlotOptions {
  count: number;
  now: number;
  window: SendWindow;
  dailyCap: number;
  /** already scheduled/sent messages per local day key (YYYY-MM-DD) */
  existingPerDay?: Record<string, number>;
  minGapMs?: number;
  rand?: () => number;
  maxDaysAhead?: number;
}

/**
 * Returns `count` UTC timestamps (ascending), spread randomly inside the window,
 * at most `dailyCap` per local day and at least `minGapMs` apart.
 */
export function assignSlots(opts: SlotOptions): number[] {
  const { count, now, window: w, dailyCap, existingPerDay = {}, minGapMs = 3 * 60_000, rand = Math.random, maxDaysAhead = 120 } = opts;
  if (w.days.length === 0 || w.endHour <= w.startHour) throw new Error('Send window is empty');
  const slots: number[] = [];
  const today = localParts(now, w.timezone);
  let cursor = Date.UTC(today.year, today.month - 1, today.day);

  for (let i = 0; i < maxDaysAhead && slots.length < count; i++, cursor += 86_400_000) {
    const d = new Date(cursor);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (!w.days.includes(isoWeekday(y, m, day))) continue;

    const start = Math.max(zonedToUtc(y, m, day, w.startHour, w.timezone), now + 60_000);
    const end = zonedToUtc(y, m, day, w.endHour, w.timezone);
    const span = end - start;
    if (span < minGapMs) continue;

    const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const room = dailyCap - (existingPerDay[key] ?? 0);
    const k = Math.min(room, count - slots.length, Math.floor(span / minGapMs));
    if (k <= 0) continue;

    // Stratified sampling: one random point in each of k equal segments, then enforce the gap.
    const seg = span / k;
    let prev = -Infinity;
    for (let j = 0; j < k; j++) {
      let t = Math.round(start + seg * j + rand() * seg);
      if (t - prev < minGapMs) t = prev + minGapMs;
      if (t >= end) break;
      slots.push(t);
      prev = t;
    }
  }
  if (slots.length < count) throw new Error('Not enough room in the send window within the next ' + maxDaysAhead + ' days');
  return slots;
}
