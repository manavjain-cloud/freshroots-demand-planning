"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> };

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const AXIS = { stroke: "var(--grid)", tick: { fill: "var(--text-3)", fontSize: 11 }, tickLine: false };
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : String(v));

function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "area" }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === "area" ? (
            <span className="inline-block size-3 rounded-sm" style={{ background: i.color }} aria-hidden />
          ) : (
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: i.color }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line-strong bg-[#0d0a0b]/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-ink-1">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            {r.color ? <span className="inline-block size-2 rounded-full" style={{ background: r.color }} aria-hidden /> : null}
            {r.label}
          </span>
          <span className="tabular font-semibold text-ink-1">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface SalesPoint {
  week: string;
  label: string;
  units: number;
  festival: boolean;
}

/** Weekly sales history with the 4- and 12-week averages drawn over their windows. */
export function SalesHistoryChart({ data, recentWeeks, baselineWeeks, recentAvg, baselineAvg }: { data: SalesPoint[]; recentWeeks: string[]; baselineWeeks: string[]; recentAvg: number | null; baselineAvg: number | null }) {
  const festival = data.filter((d) => d.festival);
  const firstF = festival[0]?.week;
  const lastF = festival[festival.length - 1]?.week;
  const label = (w: string) => data.find((d) => d.week === w)?.label ?? w;
  const has = (w: string | undefined) => !!w && data.some((d) => d.week === w);
  return (
    <figure>
      <Legend
        items={[
          { label: "Weekly units sold", color: SERIES[0] },
          ...(recentAvg !== null ? [{ label: `4-week avg (${recentAvg.toFixed(1)})`, color: SERIES[1] }] : []),
          ...(baselineAvg !== null ? [{ label: `12-week avg (${baselineAvg.toFixed(1)})`, color: SERIES[2] }] : []),
          ...(festival.length ? [{ label: "Festival-month weeks", color: "rgba(239,35,60,0.14)", kind: "area" as const }] : []),
        ]}
      />
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            {firstF && lastF ? <ReferenceArea x1={label(firstF)} x2={label(lastF)} fill="rgba(239,35,60,0.10)" stroke="none" ifOverflow="extendDomain" /> : null}
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} axisLine={false} tickFormatter={compact} width={48} />
            {recentAvg !== null && has(recentWeeks[0]) ? (
              <ReferenceLine segment={[{ x: label(recentWeeks[0]), y: recentAvg }, { x: label(recentWeeks[recentWeeks.length - 1]), y: recentAvg }]} stroke={SERIES[1]} strokeWidth={2} ifOverflow="extendDomain" />
            ) : null}
            {baselineAvg !== null && has(baselineWeeks[0]) ? (
              <ReferenceLine segment={[{ x: label(baselineWeeks[0]), y: baselineAvg }, { x: label(baselineWeeks[baselineWeeks.length - 1]), y: baselineAvg }]} stroke={SERIES[2]} strokeWidth={2} ifOverflow="extendDomain" />
            ) : null}
            <Tooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as SalesPoint | undefined;
                if (!p.active || !d) return null;
                return (
                  <TipBox
                    title={`${d.week}${d.festival ? " · festival month" : ""}`}
                    rows={[
                      { label: "Units sold", value: d.units.toLocaleString("en-IN"), color: SERIES[0] },
                      ...(recentWeeks.includes(d.week) && recentAvg !== null ? [{ label: "4-week avg", value: recentAvg.toFixed(1), color: SERIES[1] }] : []),
                      ...(baselineWeeks.includes(d.week) && baselineAvg !== null ? [{ label: "12-week avg", value: baselineAvg.toFixed(1), color: SERIES[2] }] : []),
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="units" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, fill: SERIES[0], stroke: "var(--surface-1)", strokeWidth: 2 }} activeDot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Weekly units sold with the 4-week and 12-week averages over their calculation windows.</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */

export function CategoryTrendChart({ data }: { data: { week: string; label: string; category: string; units: number }[] }) {
  const categories = useMemo(() => [...new Set(data.map((d) => d.category))].sort(), [data]);
  const rows = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>();
    for (const d of data) {
      const r = m.get(d.week) ?? { week: d.week, label: d.label };
      r[d.category] = d.units;
      m.set(d.week, r);
    }
    return [...m.values()];
  }, [data]);
  const color = (c: string) => SERIES[categories.indexOf(c) % SERIES.length];
  return (
    <figure>
      <Legend items={categories.map((c) => ({ label: c, color: color(c) }))} />
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} axisLine={false} tickFormatter={compact} width={48} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as Record<string, number | string> | undefined;
                if (!p.active || !d) return null;
                return <TipBox title={String(d.week)} rows={categories.map((c) => ({ label: c, value: Number(d[c] ?? 0).toLocaleString("en-IN"), color: color(c) }))} />;
              }}
            />
            {categories.map((c) => (
              <Line key={c} type="monotone" dataKey={c} stroke={color(c)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Total weekly units sold by product category.</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */

export interface BacktestSeries {
  skuId: string;
  skuName: string;
  wape: number | null;
  points: { week: string; label: string; actual: number; forecast: number }[];
}

export function ForecastVsActualChart({ series }: { series: BacktestSeries[] }) {
  const [sku, setSku] = useState(series[0]?.skuId ?? "");
  const s = series.find((x) => x.skuId === sku) ?? series[0];
  if (!s) return <p className="text-sm text-ink-3">Not enough history to evaluate the baseline method.</p>;
  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend
          items={[
            { label: "Actual units", color: SERIES[0] },
            { label: "Baseline estimate (4-week moving average)", color: SERIES[1] },
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-ink-3">
          SKU
          <select className="rn-input w-auto py-1.5 text-xs" value={s.skuId} onChange={(e) => setSku(e.target.value)}>
            {series.map((x) => (
              <option key={x.skuId} value={x.skuId}>
                {x.skuId} · {x.skuName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={s.points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} axisLine={false} tickFormatter={compact} width={48} domain={["auto", "auto"]} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as BacktestSeries["points"][number] | undefined;
                if (!p.active || !d) return null;
                return (
                  <TipBox
                    title={d.week}
                    rows={[
                      { label: "Actual", value: d.actual.toLocaleString("en-IN"), color: SERIES[0] },
                      { label: "Baseline estimate", value: d.forecast.toFixed(1), color: SERIES[1] },
                      { label: "Error", value: `${(d.forecast - d.actual).toFixed(1)}` },
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="actual" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, fill: SERIES[0], stroke: "var(--surface-1)", strokeWidth: 2 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="forecast" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3, fill: SERIES[1], stroke: "var(--surface-1)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs text-ink-3">
        {s.skuId}: WAPE {s.wape === null ? "n/a" : `${(s.wape * 100).toFixed(1)}%`} over {s.points.length} evaluated weeks. A one-week-ahead baseline, not the planner&apos;s rules.
      </figcaption>
    </figure>
  );
}

/** Tiny inline sparkline (no axes) for SKU cards. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label={`Weekly sales trend, ${values[0]} to ${values[values.length - 1]} units`}>
      <polyline points={pts.join(" ")} fill="none" stroke="var(--text-3)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={1.5} />
    </svg>
  );
}
