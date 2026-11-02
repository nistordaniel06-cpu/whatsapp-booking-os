import {fromMinutes, localParts, toMinutes, weekdayOf, zonedToUtc} from "./time";

export type WorkingHours = {staffId: string; weekday: number; start: string; end: string};
/** Busy period. staffId null = whole salon (e.g. closed day). */
export type Busy = {staffId: string | null; start: Date; end: Date};
export type Slot = {staffId: string; start: Date; end: Date; date: string; time: string};

export type AvailabilityInput = {
  tz: string;
  days: string[];
  durationMinutes: number;
  stepMinutes: number;
  /** Earliest bookable instant (now + minimum notice). */
  earliest: Date;
  staffIds: string[];
  hours: WorkingHours[];
  busy: Busy[];
};

/**
 * Computes bookable slots from real schedule data. The database re-validates every booking
 * (working hours, time off, exclusion constraint) — this function only proposes options.
 */
export function computeSlots(p: AvailabilityInput): Slot[] {
  if (p.durationMinutes <= 0 || p.stepMinutes <= 0) throw new Error("Invalid duration or step");
  const out: Slot[] = [];
  const staff = new Set(p.staffIds);
  for (const date of p.days) {
    const weekday = weekdayOf(date);
    for (const h of p.hours) {
      if (h.weekday !== weekday || !staff.has(h.staffId)) continue;
      const open = toMinutes(h.start);
      const close = toMinutes(h.end);
      for (let m = open; m + p.durationMinutes <= close; m += p.stepMinutes) {
        const start = zonedToUtc(date, fromMinutes(m), p.tz);
        if (!start || start < p.earliest) continue;
        const end = new Date(start.getTime() + p.durationMinutes * 60000);
        if (localParts(end, p.tz).date !== date) continue; // same rule as the database
        const clash = p.busy.some(b => (b.staffId === null || b.staffId === h.staffId) && b.start < end && start < b.end);
        if (!clash) out.push({staffId: h.staffId, start, end, date, time: fromMinutes(m)});
      }
    }
  }
  out.sort((x, y) => x.start.getTime() - y.start.getTime() || x.staffId.localeCompare(y.staffId));
  // Overlapping working-hour rows for the same person could produce duplicates.
  return out.filter((s, i) => i === 0 || s.start.getTime() !== out[i - 1].start.getTime() || s.staffId !== out[i - 1].staffId);
}

/** One option per start time ("any specialist"): first free specialist wins. */
export function uniqueByTime(slots: Slot[]): Slot[] {
  const seen = new Set<number>();
  return slots.filter(s => (seen.has(s.start.getTime()) ? false : (seen.add(s.start.getTime()), true)));
}
