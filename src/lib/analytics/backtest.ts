import { shiftIsoWeek, compareIsoWeeks } from "../weeks";

/**
 * Baseline method evaluation. A trailing N-week moving average is used as a
 * one-week-ahead demand estimate and compared with the actual sales of that week.
 * This is a separate, clearly labelled baseline; it does NOT replace the planner's rules.
 */
export interface BacktestPoint {
  week: string;
  actual: number;
  forecast: number;
  absError: number;
}

export interface BacktestSeriesResult {
  skuId: string;
  points: BacktestPoint[];
  n: number;
  /** Weighted absolute percentage error = Σ|A−F| / ΣA. null when ΣA = 0 or no points. */
  wape: number | null;
  /** Bias = Σ(F−A) / ΣA. Positive = over-forecast. */
  bias: number | null;
}

export interface BacktestResult {
  method: string;
  windowWeeks: number;
  perSku: BacktestSeriesResult[];
  overall: { n: number; wape: number | null; bias: number | null; evaluatedWeeks: string[] };
}

export function backtestMovingAverage(series: Map<string, { week: string; units: number }[]>, windowWeeks: number): BacktestResult {
  const perSku: BacktestSeriesResult[] = [];
  let sumAbs = 0;
  let sumErr = 0;
  let sumActual = 0;
  let n = 0;
  const weeks = new Set<string>();

  for (const [skuId, rows] of series) {
    const byWeek = new Map(rows.map((r) => [r.week, r.units]));
    const sorted = [...rows].sort((a, b) => compareIsoWeeks(a.week, b.week));
    const points: BacktestPoint[] = [];
    for (const r of sorted) {
      const prior: number[] = [];
      for (let k = 1; k <= windowWeeks; k++) {
        const v = byWeek.get(shiftIsoWeek(r.week, -k));
        if (v === undefined) break;
        prior.push(v);
      }
      if (prior.length < windowWeeks) continue; // needs a complete trailing window
      const forecast = prior.reduce((a, b) => a + b, 0) / windowWeeks;
      points.push({ week: r.week, actual: r.units, forecast, absError: Math.abs(r.units - forecast) });
    }
    const a = points.reduce((s, p) => s + p.actual, 0);
    const abs = points.reduce((s, p) => s + p.absError, 0);
    const err = points.reduce((s, p) => s + (p.forecast - p.actual), 0);
    perSku.push({ skuId, points, n: points.length, wape: points.length && a > 0 ? abs / a : null, bias: points.length && a > 0 ? err / a : null });
    sumAbs += abs;
    sumErr += err;
    sumActual += a;
    n += points.length;
    points.forEach((p) => weeks.add(p.week));
  }
  return {
    method: `${windowWeeks}-week trailing moving average, one week ahead`,
    windowWeeks,
    perSku,
    overall: {
      n,
      wape: n && sumActual > 0 ? sumAbs / sumActual : null,
      bias: n && sumActual > 0 ? sumErr / sumActual : null,
      evaluatedWeeks: [...weeks].sort(compareIsoWeeks),
    },
  };
}
