import { describe, expect, it } from 'vitest';
import { assignSlots, dayKey, localParts, zonedToUtc, type SendWindow } from '../src/schedule';

const NY = 'America/New_York';
const win: SendWindow = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, timezone: NY };

describe('zonedToUtc', () => {
  it('handles EST and EDT', () => {
    expect(new Date(zonedToUtc(2026, 1, 15, 9, NY)).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(new Date(zonedToUtc(2026, 7, 15, 9, NY)).toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });
  it('round-trips through localParts', () => {
    const t = zonedToUtc(2026, 3, 8, 17, NY); // DST start day
    expect(localParts(t, NY)).toMatchObject({ year: 2026, month: 3, day: 8, hour: 17 });
  });
});

describe('assignSlots', () => {
  // Wed 2026-11-04 08:00 New York = 13:00Z
  const now = Date.UTC(2026, 10, 4, 13, 0, 0);

  it('returns sorted slots inside the window with the minimum gap', () => {
    const slots = assignSlots({ count: 10, now, window: win, dailyCap: 25 });
    expect(slots).toHaveLength(10);
    for (let i = 0; i < slots.length; i++) {
      const p = localParts(slots[i], NY);
      expect(p.hour).toBeGreaterThanOrEqual(9);
      expect(p.hour).toBeLessThan(17);
      if (i > 0) expect(slots[i] - slots[i - 1]).toBeGreaterThanOrEqual(3 * 60_000);
    }
  });

  it('respects the daily cap and spills over to the next allowed day', () => {
    const slots = assignSlots({ count: 7, now, window: win, dailyCap: 3 });
    const perDay: Record<string, number> = {};
    for (const s of slots) perDay[dayKey(s, NY)] = (perDay[dayKey(s, NY)] ?? 0) + 1;
    expect(Object.values(perDay).every((n) => n <= 3)).toBe(true);
    expect(Object.keys(perDay)).toHaveLength(3);
  });

  it('skips weekends', () => {
    const fri = Date.UTC(2026, 10, 6, 22, 30, 0); // Fri 17:30 NY, window closed
    const slots = assignSlots({ count: 2, now: fri, window: win, dailyCap: 25 });
    for (const s of slots) expect(localParts(s, NY).day).toBe(9); // Monday
  });

  it('counts already scheduled messages against the cap', () => {
    const slots = assignSlots({ count: 2, now, window: win, dailyCap: 25, existingPerDay: { '2026-11-04': 24 } });
    expect(slots.filter((s) => dayKey(s, NY) === '2026-11-04')).toHaveLength(1);
  });

  it('starts after now when today is partly over', () => {
    const noon = Date.UTC(2026, 10, 4, 17, 0, 0); // 12:00 NY
    const slots = assignSlots({ count: 5, now: noon, window: win, dailyCap: 25 });
    expect(Math.min(...slots)).toBeGreaterThan(noon);
  });

  it('throws on an empty window', () => {
    expect(() => assignSlots({ count: 1, now, window: { ...win, days: [] }, dailyCap: 5 })).toThrow();
  });
});
