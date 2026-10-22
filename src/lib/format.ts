import { formatIsoDate, isoWeekEnd, isoWeekStart } from "./weeks";

export const NA = "Not available";

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const v = (ratio - 1) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return NA;
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: isoDate.length === 10 ? "UTC" : "Asia/Kolkata" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return NA;
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
}

export function fmtWeekRange(week: string): string {
  const s = formatIsoDate(isoWeekStart(week));
  const e = formatIsoDate(isoWeekEnd(week));
  const opt = { day: "numeric", month: "short", timeZone: "UTC" } as const;
  return `${new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", opt)} – ${new Date(e + "T00:00:00Z").toLocaleDateString("en-IN", opt)}`;
}

export function fmtMonth(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
