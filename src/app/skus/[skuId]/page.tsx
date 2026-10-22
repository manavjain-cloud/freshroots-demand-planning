import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2, CircleDashed, CircleHelp, CircleSlash, Zap } from "lucide-react";
import { Card, Dl, KpiCard, Notice, PageSkeleton, Unavailable } from "@/components/ui";
import { ActionPill, DemandPill, ExceptionPill, ReviewPill, RiskPill } from "@/components/pills";
import { DbMissing } from "@/components/states";
import { SalesHistoryChart } from "@/components/charts";
import { ReviewPanel } from "@/components/review-panel";
import { AiExplanationPanel } from "@/components/ai-panels";
import { dbOrNull } from "@/lib/server/page";
import { getSkuDetail, weekShortLabel, type RecRow } from "@/lib/server/queries";
import { getActiveConfig } from "@/lib/server/runs";
import { getZohoSupplyBySku, type ZohoSkuSupply } from "@/lib/server/zoho-sync";
import { getZohoStatus } from "@/lib/integrations/zoho";
import { ACTION_LABEL, DEMAND_LABEL, RISK_LABEL } from "@/lib/rules/engine";
import { isoWeekMonth } from "@/lib/weeks";
import { fmtDate, fmtDateTime, fmtMonth, fmtNum, fmtSignedPct } from "@/lib/format";
import type { RuleConfig } from "@/lib/rules/config";
import { Archive, Layers, Package, TrendingUp } from "lucide-react";

export const metadata: Metadata = { title: "SKU detail" };

export default function SkuDetailPage(props: PageProps<"/skus/[skuId]">) {
  return (
    <>
      <Link href="/skus" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink-1">
        <ArrowLeft className="size-4" aria-hidden /> All SKUs
      </Link>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <SkuDetail params={props.params} />
      </Suspense>
    </>
  );
}

async function SkuDetail({ params }: { params: PageProps<"/skus/[skuId]">["params"] }) {
  await connection();
  const { skuId } = await params;
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const d = await getSkuDetail(db, decodeURIComponent(skuId));
  if (!d) notFound();
  const rec = d.latest;
  const cal = await db.query<{ year_month: string; is_festival_month: boolean }>("SELECT year_month, is_festival_month FROM calendar_months");
  const festival = new Map(cal.rows.map((c) => [c.year_month, c.is_festival_month]));
  const { config: activeConfig } = await getActiveConfig(db);
  const zoho = await getZohoSupplyBySku(db);
  const supply: SupplyView = { synced: !!zoho.sync, configured: getZohoStatus().state === "configured", syncedAt: zoho.sync?.finishedAt ?? null, data: zoho.bySku.get(d.sku.skuId) ?? null };
  const m = rec?.metrics;
  const config = (rec ? ((await db.query<{ config: RuleConfig }>("SELECT config FROM recommendation_runs WHERE id = $1", [rec.runId])).rows[0]?.config ?? activeConfig) : activeConfig) as RuleConfig;
  const chartData = d.sales.map((s) => ({ week: s.week, label: weekShortLabel(s.week, s.weekStart), units: s.units, festival: festival.get(isoWeekMonth(s.week)) === true }));

  return (
    <div className="space-y-6">
      <header className="rn-rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">SKU detail · {d.sku.skuId}</p>
          <h1 className="text-2xl font-bold text-ink-1 md:text-[1.75rem]">{d.sku.skuName}</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            {d.sku.category} · <span className={d.sku.perishability === "High" ? "text-warning" : undefined}>{d.sku.perishability} perishability</span> · standard reorder {fmtNum(d.sku.standardReorderQty)} {d.sku.unitOfMeasure} ·{" "}
            {d.distributor ? `${d.distributor.distributorName} (${d.distributor.distributorId}, ${d.distributor.region}, ${d.distributor.status})` : `unmapped distributor ${d.sku.distributorId}`}
          </p>
        </div>
        {rec ? (
          <div className="flex flex-wrap gap-1.5">
            <DemandPill value={rec.demandClass} />
            <RiskPill value={rec.inventoryRisk} />
            <ActionPill value={rec.action} />
            <ReviewPill value={rec.reviewStatus} />
          </div>
        ) : null}
      </header>

      {!rec ? <Notice tone="warning">This SKU is not in the latest run. Run demand planning to calculate it.</Notice> : null}

      {rec && m ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label={`Latest week (${m.latestWeek ?? m.windowEndWeek})`} value={m.latestWeekUnits === null ? <Unavailable /> : fmtNum(m.latestWeekUnits)} icon={TrendingUp} hint={`4-wk avg ${fmtNum(m.recentAvg, 1)} · 12-wk avg ${fmtNum(m.baselineAvg, 1)}`} />
          <KpiCard label="Change vs 12-week avg" value={m.demandRatio === null ? <Unavailable label="Insufficient data" /> : fmtSignedPct(m.demandRatio)} icon={Layers} tone={rec.demandClass === "high_demand" ? "warning" : "neutral"} hint={`High demand if more than +${config.highDemandThresholdPct}%`} />
          <KpiCard label="Current stock" value={m.currentStock === null ? <Unavailable /> : fmtNum(m.currentStock)} icon={Package} hint={d.inventory[0] ? `${d.inventory[0].location} · as of ${fmtDate(d.inventory[0].asOfDate)}` : "No snapshot"} />
          <KpiCard
            label="Weeks of stock"
            value={m.weeksOfStock === null ? <Unavailable label="Not calculable" /> : fmtNum(m.weeksOfStock, 2)}
            icon={Archive}
            tone={rec.inventoryRisk === "within_range" ? "good" : rec.inventoryRisk.includes("below") || rec.inventoryRisk === "stockout_risk" ? "critical" : rec.inventoryRisk.includes("above") || rec.inventoryRisk === "overstock_risk" ? "serious" : "info"}
            hint={`Window ${m.minWeeks}–${m.maxWeeks} weeks${m.isPerishable ? " (perishable)" : ""}`}
          />
        </div>
      ) : null}

      <Card title="Weekly sales history" description={`${d.sales.length} weeks supplied (${d.sales[0]?.week ?? "—"} to ${d.sales[d.sales.length - 1]?.week ?? "—"}). Shaded weeks fall in festival months per the calendar seed.`}>
        {d.sales.length ? (
          <SalesHistoryChart data={chartData} recentWeeks={m?.recentWeeks ?? []} baselineWeeks={m?.baselineWeeks ?? []} recentAvg={m?.recentAvg ?? null} baselineAvg={m?.baselineAvg ?? null} />
        ) : (
          <Unavailable label="No sales history supplied" />
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-2 hover:text-ink-1">Show weekly values (table view)</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Week starting</th>
                  <th className="text-right">Units sold</th>
                  <th>In window</th>
                </tr>
              </thead>
              <tbody>
                {d.sales.map((s) => (
                  <tr key={s.week}>
                    <td>{s.week}</td>
                    <td>{fmtDate(s.weekStart)}</td>
                    <td className="tabular text-right">{fmtNum(s.units)}</td>
                    <td className="text-xs text-ink-3">{m?.recentWeeks.includes(s.week) ? "4-wk + 12-wk" : m?.baselineWeeks.includes(s.week) ? "12-wk" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      {rec && m ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card title="Calculation" description={`Run #${rec.runId} · engine output, recomputable from the stored inputs and configuration`}>
            <Calculation rec={rec} config={config} supply={supply} />
          </Card>
          <Card title="Applicable business rules" description="Raghav's documented rules as applied to this SKU">
            <RulesApplied rec={rec} config={config} />
          </Card>
        </div>
      ) : null}

      {rec ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card title="Recommendation review" description={rec.exceptionCodes.length ? undefined : "Approve, edit or reject this recommendation"}>
            {rec.exceptionCodes.length ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {rec.exceptionCodes.map((c) => (
                  <ExceptionPill key={c} code={c} />
                ))}
              </div>
            ) : null}
            <ReviewPanel
              key={rec.id}
              recommendationId={rec.id}
              calculatedQty={rec.recommendedQty}
              calculatedQtyRaw={rec.recommendedQtyRaw}
              standardReorderQty={d.sku.standardReorderQty}
              unit={d.sku.unitOfMeasure}
              status={rec.reviewStatus}
              finalQty={rec.finalQty}
              decisions={d.decisions.filter((x) => x.recommendationId === rec.id)}
            />
          </Card>
          <AiExplanationPanel recommendationId={rec.id} />
        </div>
      ) : null}

      <Card title="Recommendation history" description="Every run that included this SKU, with the human decision recorded against it">
        {d.history.length ? (
          <div className="overflow-x-auto">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Calculated</th>
                  <th>Inventory as of</th>
                  <th>Demand</th>
                  <th>Risk</th>
                  <th>Action</th>
                  <th className="text-right">Calc. qty</th>
                  <th className="text-right">Final qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}>
                    <td>#{h.runId}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(h.runCreatedAt)}</td>
                    <td>{fmtDate(h.asOfDate)}</td>
                    <td className="text-xs">{DEMAND_LABEL[h.demandClass as keyof typeof DEMAND_LABEL] ?? h.demandClass}</td>
                    <td className="text-xs">{RISK_LABEL[h.inventoryRisk as keyof typeof RISK_LABEL] ?? h.inventoryRisk}</td>
                    <td className="text-xs">{ACTION_LABEL[h.action as keyof typeof ACTION_LABEL] ?? h.action}</td>
                    <td className="tabular text-right">{fmtNum(h.recommendedQty)}</td>
                    <td className="tabular text-right">{fmtNum(h.finalQty)}</td>
                    <td>
                      <ReviewPill value={h.reviewStatus as "pending"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-3">No runs yet.</p>
        )}
      </Card>
    </div>
  );
}

type SupplyView = { synced: boolean; configured: boolean; syncedAt: string | null; data: ZohoSkuSupply | null };

function supplyReason(s: SupplyView): string {
  if (!s.configured) return "Zoho Inventory is not connected";
  if (!s.synced) return "Zoho is configured but has not been synced yet";
  return "No Zoho item has this SKU";
}

function Calculation({ rec, config, supply }: { rec: RecRow & { steps: { step: string; rule: string; result: string }[] }; config: RuleConfig; supply: SupplyView }) {
  const m = rec.metrics;
  return (
    <div className="space-y-5">
      <Dl
        items={[
          { label: `4-week window (${m.recentWeeks[0]}–${m.windowEndWeek})`, value: m.recentSum === null ? <Unavailable label="Incomplete" /> : `${fmtNum(m.recentSum)} ÷ ${config.recentWindowWeeks} = ${fmtNum(m.recentAvg, 2)} /wk` },
          { label: `12-week window (${m.baselineWeeks[0]}–${m.windowEndWeek})`, value: m.baselineSum === null ? <Unavailable label="Incomplete" /> : `${fmtNum(m.baselineSum)} ÷ ${config.baselineWindowWeeks} = ${fmtNum(m.baselineAvg, 2)} /wk` },
          {
            label: "Recent vs baseline",
            value: m.demandRatio === null ? <Unavailable label="Not calculable" /> : `${fmtNum(m.demandRatio, 3)}× (${fmtSignedPct(m.demandRatio)})`,
            hint: `High demand if > ${1 + config.highDemandThresholdPct / 100}× (strictly more than ${config.highDemandThresholdPct}%)${config.festivalUpliftMode === "recent_window_only" && m.festivalFactor > 1 ? "; recent window uplifted" : ""}`,
          },
          {
            label: "Festival adjustment",
            value: m.isFestivalMonth === null ? <Unavailable label="Month not in calendar" /> : m.isFestivalMonth ? `× ${m.festivalFactor} (${fmtMonth(m.planningMonth)})` : `None (${fmtMonth(m.planningMonth)})`,
            hint: `${m.baselineFestivalWeeks} of ${m.baselineWeeks.length} baseline weeks fall in festival months (not adjusted)`,
          },
          {
            label: `Forward demand (${m.coverageBasis === "baseline_avg" ? "12-week" : "4-week"} avg × factor)`,
            value: m.forwardDemand === null ? <Unavailable label="Not calculable" /> : `${fmtNum(m.coverageBaseDemand, 2)} × ${m.festivalFactor} = ${fmtNum(m.forwardDemand, 2)} /wk`,
          },
          {
            label: "Weeks of stock",
            value: m.weeksOfStock === null ? <Unavailable label="Not calculable" /> : `${fmtNum(m.currentStock)} ÷ ${fmtNum(m.forwardDemand, 2)} = ${fmtNum(m.weeksOfStock, 2)}`,
            hint: `Applicable window ${m.minWeeks}–${m.maxWeeks} weeks${m.isPerishable ? " (high-perishability rule)" : ""}`,
          },
          {
            label: "Recommendation",
            value: `${ACTION_LABEL[rec.action]}${rec.recommendedQty !== null ? ` · ${fmtNum(rec.recommendedQty)} units` : ""}`,
            hint: rec.recommendedQtyRaw !== null ? `Raw ${rec.recommendedQtyRaw}; rounding: ${config.roundingMode}` : "No rule-defined quantity",
          },
          { label: "Projected cover after reorder", value: m.projectedWeeksAfterOrder === null ? "—" : `${fmtNum(m.projectedWeeksAfterOrder, 2)} weeks`, hint: "Rule quantity added to on-hand stock; excludes open orders and lead time" },
          {
            label: "On order (Zoho, open POs)",
            value: supply.data ? `${fmtNum(supply.data.onOrder)} units` : <Unavailable reason={supplyReason(supply)} />,
            hint: supply.data
              ? `${supply.data.openLines.length} open line(s) · synced ${fmtDateTime(supply.syncedAt)}${supply.data.onOrder > 0 && m.forwardDemand ? ` · cover incl. on-order ${fmtNum(((m.currentStock ?? 0) + supply.data.onOrder) / m.forwardDemand, 2)} wks (informational, not used by the rules)` : ""}`
              : supplyReason(supply),
          },
          {
            label: "Observed lead time (Zoho history)",
            value: supply.data?.leadTime ? `${fmtNum(supply.data.leadTime.median, 1)} days (median)` : <Unavailable reason={supply.data ? "No received purchase orders for this SKU in the history window" : supplyReason(supply)} />,
            hint: supply.data?.leadTime ? `PO date → first receipt over ${supply.data.leadTime.n} PO(s), range ${supply.data.leadTime.min}–${supply.data.leadTime.max} days. Observed, not a supplier commitment.` : undefined,
          },
        ]}
      />
      {supply.data?.openLines.length ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Open purchase orders (Zoho, read-only)</h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Status</th>
                  <th>Ordered on</th>
                  <th>Expected</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {supply.data.openLines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.purchaseorderNumber ?? "—"}
                      <div className="text-[0.6875rem] text-ink-3">{l.vendorName ?? ""}</div>
                    </td>
                    <td className="text-xs">{l.poStatus?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="text-xs">{l.poDate ? fmtDate(l.poDate) : "—"}</td>
                    <td className="text-xs">{l.expectedDeliveryDate ? fmtDate(l.expectedDeliveryDate) : "Not set"}</td>
                    <td className="tabular text-right">{fmtNum(l.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Rule-engine trace</h3>
        <ol className="space-y-2">
          {rec.steps.map((s, i) => (
            <li key={s.step} className="rounded-lg border border-line bg-white/[0.02] p-2.5 text-[0.8125rem]">
              <p className="font-medium text-ink-1">
                {i + 1}. {s.step.replace(/_/g, " ")}
              </p>
              <p className="text-xs text-ink-3">{s.rule}</p>
              <p className="mt-0.5 text-ink-2">{s.result}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function RulesApplied({ rec, config }: { rec: RecRow; config: RuleConfig }) {
  const m = rec.metrics;
  type S = "triggered" | "not_triggered" | "na" | "unknown";
  const rules: { name: string; text: string; status: S; detail: string }[] = [
    {
      name: "Rule 1 · High demand",
      text: `4-week avg more than ${config.highDemandThresholdPct}% above 12-week avg → reorder at ${config.highDemandReorderMultiplier}× standard.`,
      status: rec.demandClass === "insufficient_data" ? "unknown" : rec.demandClass === "high_demand" ? "triggered" : "not_triggered",
      detail: m.demandRatio === null ? "Incomplete sales window." : `${fmtSignedPct(m.demandRatio)} vs baseline.`,
    },
    {
      name: "Rule 2 · Stockout risk",
      text: `Non-perishable stock below ${config.stockoutMinWeeks} weeks of average sales → immediate reorder.`,
      status: m.isPerishable ? "na" : m.weeksOfStock === null ? "unknown" : rec.inventoryRisk === "stockout_risk" ? "triggered" : "not_triggered",
      detail: m.isPerishable ? "Perishable window applies instead." : m.weeksOfStock === null ? "Weeks of stock not calculable." : `${fmtNum(m.weeksOfStock, 2)} weeks.`,
    },
    {
      name: "Rule 3 · Overstock risk",
      text: `Non-perishable stock above ${config.overstockMaxWeeks} weeks → pause next order.`,
      status: m.isPerishable ? "na" : m.weeksOfStock === null ? "unknown" : rec.inventoryRisk === "overstock_risk" ? "triggered" : "not_triggered",
      detail: m.isPerishable ? "Perishable window applies instead." : m.weeksOfStock === null ? "Weeks of stock not calculable." : `${fmtNum(m.weeksOfStock, 2)} weeks.`,
    },
    {
      name: "Rule 4 · Festival uplift",
      text: `October, November, March: +${config.festivalUpliftPct}% demand before threshold checks.`,
      status: m.isFestivalMonth === null ? "unknown" : m.isFestivalMonth ? "triggered" : "not_triggered",
      detail: m.isFestivalMonth === null ? "Planning month missing from calendar." : `${fmtMonth(m.planningMonth)} ${m.isFestivalMonth ? "is" : "is not"} a festival month.`,
    },
    {
      name: "Rule 5 · Perishable window",
      text: `High-perishability SKUs: minimum ${config.perishableMinWeeks}, maximum ${config.perishableMaxWeeks} weeks of stock.`,
      status: !m.isPerishable ? "na" : m.weeksOfStock === null ? "unknown" : rec.inventoryRisk === "within_range" ? "not_triggered" : "triggered",
      detail: !m.isPerishable ? "Not a high-perishability SKU." : m.weeksOfStock === null ? "Weeks of stock not calculable." : `${fmtNum(m.weeksOfStock, 2)} weeks → ${RISK_LABEL[rec.inventoryRisk]}.`,
    },
  ];
  const icon = { triggered: Zap, not_triggered: CircleDashed, na: CircleSlash, unknown: CircleHelp } as const;
  const label = { triggered: "Triggered", not_triggered: "Not triggered", na: "Not applicable", unknown: "Cannot evaluate" } as const;
  const tone = { triggered: "text-warning", not_triggered: "text-ink-3", na: "text-ink-3", unknown: "text-info" } as const;
  return (
    <ul className="space-y-2.5">
      {rules.map((r) => {
        const Icon = icon[r.status];
        return (
          <li key={r.name} className="rounded-lg border border-line bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-ink-1">{r.name}</p>
              <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${tone[r.status]}`}>
                <Icon className="size-3.5" aria-hidden /> {label[r.status]}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-3">{r.text}</p>
            <p className="mt-1 text-[0.8125rem] text-ink-2">{r.detail}</p>
          </li>
        );
      })}
      <li className="flex items-start gap-2 rounded-lg border border-line bg-white/[0.02] p-3 text-xs text-ink-3">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
        Precedence: data checks → overstock pause → below minimum → high demand → no action. Conflicts are escalated, never silently resolved.
      </li>
    </ul>
  );
}
