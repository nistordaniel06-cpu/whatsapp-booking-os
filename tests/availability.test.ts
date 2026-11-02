import {describe, it, expect} from "vitest";
import {computeSlots, uniqueByTime} from "../src/lib/availability";
import {zonedToUtc, localParts, dayLabelRo} from "../src/lib/time";

const TZ = "Europe/Bucharest";

describe("time zones", () => {
  it("converts Bucharest wall time to UTC in winter and summer", () => {
    expect(zonedToUtc("2026-11-03", "10:00", TZ)?.toISOString()).toBe("2026-11-03T08:00:00.000Z"); // UTC+2
    expect(zonedToUtc("2026-07-03", "10:00", TZ)?.toISOString()).toBe("2026-07-03T07:00:00.000Z"); // UTC+3
  });
  it("handles DST days", () => {
    expect(zonedToUtc("2026-03-29", "03:30", TZ)).toBeNull(); // skipped hour
    expect(zonedToUtc("2026-03-29", "10:00", TZ)?.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(zonedToUtc("2026-10-25", "10:00", TZ)?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
  it("round-trips", () => {
    const l = localParts(new Date("2026-11-03T12:30:00Z"), TZ);
    expect(l).toMatchObject({date: "2026-11-03", time: "14:30", weekday: 2});
  });
  it("labels days in Romanian", () => {
    expect(dayLabelRo("2026-11-02", "2026-11-02")).toBe("Azi");
    expect(dayLabelRo("2026-11-03", "2026-11-02")).toBe("Mâine");
    expect(dayLabelRo("2026-11-05", "2026-11-02")).toMatch(/joi/);
  });
});

describe("computeSlots", () => {
  const base = {
    tz: TZ, days: ["2026-11-03"], durationMinutes: 30, stepMinutes: 30,
    earliest: new Date("2026-11-01T00:00:00Z"), staffIds: ["a", "b"],
    hours: [{staffId: "a", weekday: 2, start: "09:00", end: "11:00"}, {staffId: "b", weekday: 2, start: "10:00", end: "11:00"}],
    busy: [],
  };

  it("generates slots that fit inside working hours", () => {
    const a = computeSlots({...base, staffIds: ["a"]});
    expect(a.map(s => s.time)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("respects longer services", () => {
    expect(computeSlots({...base, staffIds: ["a"], durationMinutes: 60}).map(s => s.time)).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("removes booked, time-off and past slots", () => {
    const slots = computeSlots({...base, staffIds: ["a"],
      earliest: new Date("2026-11-03T07:15:00Z"), // 09:15 local
      busy: [
        {staffId: "a", start: new Date("2026-11-03T08:00:00Z"), end: new Date("2026-11-03T08:30:00Z")}, // 10:00-10:30
        {staffId: "b", start: new Date("2026-11-03T08:30:00Z"), end: new Date("2026-11-03T09:00:00Z")}, // other person
      ]});
    expect(slots.map(s => s.time)).toEqual(["09:30", "10:30"]);
  });

  it("salon-wide closure blocks everyone", () => {
    const slots = computeSlots({...base, busy: [{staffId: null, start: new Date("2026-11-03T00:00:00Z"), end: new Date("2026-11-04T00:00:00Z")}]});
    expect(slots).toHaveLength(0);
  });

  it("ignores days without working hours", () => {
    expect(computeSlots({...base, days: ["2026-11-04"]})).toHaveLength(0);
  });

  it("dedupes by time for 'any specialist'", () => {
    const u = uniqueByTime(computeSlots(base));
    expect(u.map(s => `${s.time}${s.staffId}`)).toEqual(["09:00a", "09:30a", "10:00a", "10:30a"]);
  });
});
