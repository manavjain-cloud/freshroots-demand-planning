"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, X } from "lucide-react";
import type { DemandClass, ExceptionCode, InventoryRisk, RecommendationAction } from "@/lib/rules/engine";
import { ACTION_LABEL, DEMAND_LABEL, EXCEPTION_INFO, RISK_LABEL } from "@/lib/rules/engine";
import { toCsv } from "@/lib/csv";
import { ActionPill, DemandPill, REVIEW_LABEL, ReviewPill, RiskPill } from "./pills";
import { cn } from "./ui";

export interface PlanRow {
  id: number;
  skuId: string;
  skuName: string;
  category: string;
  perishability: string;
  distributorId: string | null;
  distributorName: string | null;
  region: string | null;
  latestWeekUnits: number | null;
  recentAvg: number | null;
  baselineAvg: number | null;
  currentStock: number | null;
  /** Outstanding on open Zoho POs; null when Zoho has not been synced or the SKU is not mapped. */
  onOrder: number | null;
  weeksOfStock: number | null;
  minWeeks: number;
  maxWeeks: number;
  demandClass: DemandClass;
  inventoryRisk: InventoryRisk;
  action: RecommendationAction;
  recommendedQty: number | null;
  finalQty: number | null;
  reason: string;
  reviewStatus: keyof typeof REVIEW_LABEL;
  exceptionCodes: ExceptionCode[];
}

type SortKey = "skuId" | "category" | "latestWeekUnits" | "recentAvg" | "baselineAvg" | "currentStock" | "onOrder" | "weeksOfStock" | "recommendedQty" | "risk" | "status";
const RISK_ORDER: InventoryRisk[] = ["stockout_risk", "perishable_below_min", "overstock_risk", "perishable_above_max", "no_recent_demand", "insufficient_data", "within_range"];
const RISK_FILTERS = [
  { value: "", label: "All risk types" },
  { value: "below_min", label: "Stockout / below minimum" },
  { value: "above_max", label: "Overstock / above maximum" },
  { value: "high_demand", label: "High demand" },
  { value: "exceptions", label: "Has exceptions" },
  { value: "insufficient", label: "Insufficient data" },
  { value: "within_range", label: "Within range" },
];

const n1 = (v: number | null, d = 0) => (v === null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));

function matchesRisk(r: PlanRow, risk: string) {
  switch (risk) {
    case "below_min":
      return r.inventoryRisk === "stockout_risk" || r.inventoryRisk === "perishable_below_min";
    case "above_max":
      return r.inventoryRisk === "overstock_risk" || r.inventoryRisk === "perishable_above_max";
    case "high_demand":
      return r.demandClass === "high_demand";
    case "exceptions":
      return r.exceptionCodes.length > 0;
    case "insufficient":
      return r.inventoryRisk === "insufficient_data" || r.inventoryRisk === "no_recent_demand" || r.demandClass === "insufficient_data";
    case "within_range":
      return r.inventoryRisk === "within_range";
    default:
      return true;
  }
}

export function PlanningTable({ rows, initialRisk = "", runId, zohoSynced = false }: { rows: PlanRow[]; initialRisk?: string; runId: number; zohoSynced?: boolean }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [distributor, setDistributor] = useState("");
  const [region, setRegion] = useState("");
  const [perish, setPerish] = useState("");
  const [risk, setRisk] = useState(RISK_FILTERS.some((f) => f.value === initialRisk) ? initialRisk : "");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "risk", dir: 1 });

  const opts = useMemo(() => {
    const uniq = (f: (r: PlanRow) => string | null) => [...new Set(rows.map(f).filter((x): x is string => !!x))].sort();
    return {
      categories: uniq((r) => r.category),
      distributors: [...new Map(rows.filter((r) => r.distributorId).map((r) => [r.distributorId!, r.distributorName ?? r.distributorId!])).entries()].sort(),
      regions: uniq((r) => r.region),
      perish: uniq((r) => r.perishability),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (!term || r.skuId.toLowerCase().includes(term) || r.skuName.toLowerCase().includes(term)) &&
        (!category || r.category === category) &&
        (!distributor || r.distributorId === distributor) &&
        (!region || r.region === region) &&
        (!perish || r.perishability === perish) &&
        (!status || r.reviewStatus === status) &&
        matchesRisk(r, risk),
    );
    const val = (r: PlanRow): string | number => {
      switch (sort.key) {
        case "risk":
          return RISK_ORDER.indexOf(r.inventoryRisk) * 10 + (r.demandClass === "high_demand" ? 0 : 1);
        case "status":
          return r.reviewStatus;
        case "skuId":
        case "category":
          return r[sort.key];
        default:
          return r[sort.key] ?? Number.POSITIVE_INFINITY;
      }
    };
    return out.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * sort.dir || a.skuId.localeCompare(b.skuId);
    });
  }, [rows, q, category, distributor, region, perish, risk, status, sort]);

  const active = [q, category, distributor, region, perish, risk, status].some(Boolean);
  const clear = () => {
    setQ("");
    setCategory("");
    setDistributor("");
    setRegion("");
    setPerish("");
    setRisk("");
    setStatus("");
  };

  function exportView() {
    const csv = toCsv<PlanRow>(
      [
        { header: "Run_ID", value: () => runId },
        { header: "SKU_ID", value: (r) => r.skuId },
        { header: "SKU_Name", value: (r) => r.skuName },
        { header: "Category", value: (r) => r.category },
        { header: "Perishability", value: (r) => r.perishability },
        { header: "Distributor", value: (r) => r.distributorName },
        { header: "Region", value: (r) => r.region },
        { header: "Latest_Week_Units", value: (r) => r.latestWeekUnits },
        { header: "Avg_4wk", value: (r) => (r.recentAvg === null ? null : Math.round(r.recentAvg * 100) / 100) },
        { header: "Avg_12wk", value: (r) => (r.baselineAvg === null ? null : Math.round(r.baselineAvg * 100) / 100) },
        { header: "Current_Stock", value: (r) => r.currentStock },
        { header: "On_Order_Zoho", value: (r) => r.onOrder },
        { header: "Weeks_Of_Stock", value: (r) => (r.weeksOfStock === null ? null : Math.round(r.weeksOfStock * 100) / 100) },
        { header: "Demand", value: (r) => DEMAND_LABEL[r.demandClass] },
        { header: "Inventory_Risk", value: (r) => RISK_LABEL[r.inventoryRisk] },
        { header: "Action", value: (r) => ACTION_LABEL[r.action] },
        { header: "Recommended_Qty", value: (r) => r.recommendedQty },
        { header: "Review_Status", value: (r) => REVIEW_LABEL[r.reviewStatus] },
        { header: "Final_Qty", value: (r) => r.finalQty },
        { header: "Exceptions", value: (r) => r.exceptionCodes.map((c) => EXCEPTION_INFO[c].label).join("; ") },
        { header: "Reason", value: (r) => r.reason },
      ],
      filtered,
    );
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `freshroots-planning-run${runId}-filtered.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => {
    const on = sort.key === k;
    return (
      <th className={className} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 hover:text-ink-1" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))}>
          {children}
          {on ? sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
        </button>
      </th>
    );
  };

  const select = (label: string, value: string, set: (v: string) => void, options: [string, string][], all: string) => (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select className="rn-input" value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="rn-card rn-rise overflow-hidden">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search SKUs</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input className="rn-input pl-9" placeholder="Search SKU ID or product name" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            {active ? (
              <button type="button" className="rn-btn rn-btn-ghost" onClick={clear}>
                <X className="size-4" aria-hidden /> Clear
              </button>
            ) : null}
            <button type="button" className="rn-btn rn-btn-ghost" onClick={exportView} disabled={!filtered.length}>
              <Download className="size-4" aria-hidden /> Export view
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {select("Category", category, setCategory, opts.categories.map((c) => [c, c]), "All categories")}
          {select("Distributor", distributor, setDistributor, opts.distributors.map(([id, name]) => [id, `${name} (${id})`]), "All distributors")}
          {select("Region", region, setRegion, opts.regions.map((r) => [r, r]), "All regions")}
          {select("Perishability", perish, setPerish, opts.perish.map((p) => [p, `${p} perishability`]), "All perishability")}
          {select("Risk type", risk, setRisk, RISK_FILTERS.slice(1).map((f) => [f.value, f.label]), "All risk types")}
          {select("Review status", status, setStatus, Object.entries(REVIEW_LABEL) as [string, string][], "All statuses")}
        </div>
        <p className="text-xs text-ink-3" aria-live="polite">
          Showing {filtered.length} of {rows.length} SKUs
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden max-h-[70vh] overflow-auto md:block">
        <table className="rn-table min-w-[1560px]">
          <thead>
            <tr>
              <Th k="skuId" className="min-w-[190px]">SKU</Th>
              <Th k="category" className="min-w-[120px]">Category</Th>
              <th className="min-w-[160px]">Distributor · region</th>
              <Th k="latestWeekUnits" className="text-right">Latest wk</Th>
              <Th k="recentAvg" className="text-right">4-wk avg</Th>
              <Th k="baselineAvg" className="text-right">12-wk avg</Th>
              <Th k="currentStock" className="text-right">Stock</Th>
              {zohoSynced ? <Th k="onOrder" className="text-right">On order</Th> : null}
              <Th k="weeksOfStock" className="text-right">Wks of stock</Th>
              <Th k="risk">Demand · risk</Th>
              <Th k="recommendedQty" className="text-right">Rec. qty</Th>
              <th className="min-w-[340px]">Reason</th>
              <Th k="status">Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/skus/${encodeURIComponent(r.skuId)}`} className="font-medium text-ink-1 underline-offset-2 hover:underline">
                    {r.skuName}
                  </Link>
                  <div className="text-xs text-ink-3">{r.skuId}</div>
                </td>
                <td>
                  <div className="text-ink-1">{r.category}</div>
                  <div className={cn("text-xs", r.perishability === "High" ? "text-warning" : "text-ink-3")}>{r.perishability} perishability</div>
                </td>
                <td>
                  {r.distributorName ? (
                    <>
                      <div className="text-ink-1">{r.distributorName}</div>
                      <div className="text-xs text-ink-3">{r.region}</div>
                    </>
                  ) : (
                    <span className="text-xs text-warning">Unmapped ({r.distributorId ?? "none"})</span>
                  )}
                </td>
                <td className="tabular text-right">{n1(r.latestWeekUnits)}</td>
                <td className="tabular text-right">{n1(r.recentAvg, 1)}</td>
                <td className="tabular text-right">{n1(r.baselineAvg, 1)}</td>
                <td className="tabular text-right">{n1(r.currentStock)}</td>
                {zohoSynced ? <td className="tabular text-right" title="Outstanding on open Zoho purchase orders (not used by the rules)">{r.onOrder === null ? <span className="text-ink-3">n/a</span> : n1(r.onOrder)}</td> : null}
                <td className="tabular text-right">
                  <span className="font-semibold text-ink-1">{n1(r.weeksOfStock, 1)}</span>
                  <div className="text-[0.6875rem] text-ink-3">
                    window {r.minWeeks}–{r.maxWeeks}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <DemandPill value={r.demandClass} />
                    <RiskPill value={r.inventoryRisk} />
                  </div>
                </td>
                <td className="tabular text-right">
                  <div className="font-semibold text-ink-1">{r.recommendedQty === null ? "—" : n1(r.recommendedQty)}</div>
                  <div className="mt-1 flex justify-end">
                    <ActionPill value={r.action} />
                  </div>
                </td>
                <td className="text-xs leading-relaxed text-ink-2">{r.reason}</td>
                <td>
                  <ReviewPill value={r.reviewStatus} />
                  {r.reviewStatus !== "not_required" ? (
                    <div className="mt-1.5">
                      <Link href={`/recommendations?rec=${r.id}`} className="text-xs font-medium text-accent underline-offset-2 hover:underline">
                        {r.reviewStatus === "pending" ? "Review" : "View review"}
                      </Link>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <p className="p-6 text-center text-sm text-ink-3">No SKUs match these filters.</p> : null}
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-line md:hidden">
        {filtered.map((r) => (
          <li key={r.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/skus/${encodeURIComponent(r.skuId)}`} className="font-medium text-ink-1">
                  {r.skuName}
                </Link>
                <p className="text-xs text-ink-3">
                  {r.skuId} · {r.category} · {r.perishability} perishability
                </p>
              </div>
              <ReviewPill value={r.reviewStatus} />
            </div>
            <div className="flex flex-wrap gap-1">
              <DemandPill value={r.demandClass} />
              <RiskPill value={r.inventoryRisk} />
              <ActionPill value={r.action} />
            </div>
            <dl className="tabular grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-ink-3">4 / 12-wk avg</dt>
                <dd className="text-ink-1">
                  {n1(r.recentAvg, 1)} / {n1(r.baselineAvg, 1)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Stock · weeks</dt>
                <dd className="text-ink-1">
                  {n1(r.currentStock)} · {n1(r.weeksOfStock, 1)}
                  {zohoSynced && r.onOrder ? <span className="block text-ink-3">+{n1(r.onOrder)} on order</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Rec. qty</dt>
                <dd className="font-semibold text-ink-1">{r.recommendedQty === null ? "—" : n1(r.recommendedQty)}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-ink-2">{r.reason}</p>
            {r.reviewStatus !== "not_required" ? (
              <Link href={`/recommendations?rec=${r.id}`} className="text-xs font-medium text-accent">
                {r.reviewStatus === "pending" ? "Review →" : "View review →"}
              </Link>
            ) : null}
          </li>
        ))}
        {filtered.length === 0 ? <li className="p-6 text-center text-sm text-ink-3">No SKUs match these filters.</li> : null}
      </ul>
    </div>
  );
}
