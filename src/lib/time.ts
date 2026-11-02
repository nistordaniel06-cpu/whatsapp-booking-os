/** Timezone helpers without external dependencies. Dates are "YYYY-MM-DD", times "HH:MM". */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"});
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(instant: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(instant).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return {date, time, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: weekdayOf(date), seconds: Number(p.second)};
}

function offsetMinutes(instant: Date, tz: string) {
  const l = localParts(instant, tz);
  const [y, m, d] = l.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(l.minutes / 60), l.minutes % 60, l.seconds);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock time in `tz` → UTC instant. Returns null for times skipped by DST. */
export function zonedToUtc(date: string, time: string, tz: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const second = guess - offsetMinutes(new Date(result), tz) * 60000;
  if (second !== result) result = second;
  const check = localParts(new Date(result), tz);
  if (check.date !== date || check.time !== time.slice(0, 5)) return null;
  return new Date(result);
}

export function weekdayOf(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Romanian day label, e.g. "Azi", "Mâine", "joi, 5 nov.". */
export function dayLabelRo(date: string, today: string) {
  if (date === today) return "Azi";
  if (date === addDays(today, 1)) return "Mâine";
  return new Intl.DateTimeFormat("ro-RO", {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"}).format(new Date(date + "T12:00:00Z"));
}
