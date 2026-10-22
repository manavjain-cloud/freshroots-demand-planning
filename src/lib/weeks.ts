/**
 * ISO-8601 week helpers. All dates are calendar dates (YYYY-MM-DD) handled in UTC
 * so results never depend on the server's time zone.
 */

const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseIsoDate(value: string): Date | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Number of ISO weeks in a year (52 or 53). */
export function isoWeeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  return isoWeekOf(dec28).week;
}

/** Monday of ISO week 1 of `year`. */
function isoWeek1Monday(year: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(jan4, -dow);
}

export function isoWeekOf(d: Date): { year: number; week: number } {
  const thursday = addDays(d, 3 - ((d.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - isoWeek1Monday(year).getTime()) / (7 * DAY_MS)) + 1;
  return { year, week };
}

export function formatIsoWeek(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseIsoWeek(value: string): { year: number; week: number } | null {
  const m = WEEK_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  return { year, week };
}

/** Monday (start date) of an ISO week label such as 2026-W42. */
export function isoWeekStart(value: string): Date {
  const p = parseIsoWeek(value);
  if (!p) throw new Error(`Invalid ISO week: ${value}`);
  return addDays(isoWeek1Monday(p.year), (p.week - 1) * 7);
}

export function isoWeekEnd(value: string): Date {
  return addDays(isoWeekStart(value), 6);
}

export function shiftIsoWeek(value: string, delta: number): string {
  const w = isoWeekOf(addDays(isoWeekStart(value), delta * 7));
  return formatIsoWeek(w.year, w.week);
}

/** Calendar month (YYYY-MM) a week belongs to, using the ISO convention (its Thursday). */
export function isoWeekMonth(value: string): string {
  const thursday = addDays(isoWeekStart(value), 3);
  return formatIsoDate(thursday).slice(0, 7);
}

/**
 * Latest ISO week that is fully complete before `asOf` (its Sunday is strictly
 * earlier than the as-of date). For an as-of date of Monday 2026-10-19 this is 2026-W42.
 */
export function latestCompleteWeek(asOf: string): string {
  const d = parseIsoDate(asOf);
  if (!d) throw new Error(`Invalid date: ${asOf}`);
  const prevDay = addDays(d, -1);
  const dow = (prevDay.getUTCDay() + 6) % 7; // 6 = Sunday
  const lastSunday = dow === 6 ? prevDay : addDays(prevDay, -(dow + 1));
  const w = isoWeekOf(lastSunday);
  return formatIsoWeek(w.year, w.week);
}

/** The `count` weeks ending at `endWeek`, oldest first. */
export function weekWindow(endWeek: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftIsoWeek(endWeek, -i));
  return out;
}

export function compareIsoWeeks(a: string, b: string): number {
  return isoWeekStart(a).getTime() - isoWeekStart(b).getTime();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  if (!a || !b) throw new Error("Invalid date");
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Today's calendar date in India (business locale of the case). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
