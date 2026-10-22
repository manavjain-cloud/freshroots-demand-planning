import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, Download } from "lucide-react";
import { Card, EmptyState, Notice, PageHeader, PageSkeleton } from "@/components/ui";
import { ActionPill, DemandPill, ExceptionPill, ReviewPill, RiskPill } from "@/components/pills";
import { DbMissing, NoRunYet } from "@/components/states";
import { ReviewPanel } from "@/components/review-panel";
import { AiExplanationPanel } from "@/components/ai-panels";
import { byPriority, dbOrNull } from "@/lib/server/page";
import { getDecisions, getLatestRun, getRunRecommendations, type RecRow } from "@/lib/server/queries";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/components/ui";

export const metadata: Metadata = { title: "Recommendations" };

const VIEWS = [
  { key: "pending", label: "Pending review", match: (r: RecRow) => r.reviewStatus === "pending" },
  { key: "exceptions", label: "Exception queue", match: (r: RecRow) => r.exceptionCodes.length > 0 },
  { key: "reviewed", label: "Reviewed", match: (r: RecRow) => ["approved", "edited", "rejected"].includes(r.reviewStatus) },
  { key: "all", label: "All SKUs", match: () => true },
] as const;

export default function RecommendationsPage(props: PageProps<"/recommendations">) {
  return (
    <>
      <PageHeader
        eyebrow="Recommendations"
        title="Recommendation review"
        description="Approve, edit or reject each recommendation. The original calculated quantity is always kept beside any edit, and every decision is logged with a timestamp."
        actions={
          <a href="/api/export/review-log" className="rn-btn rn-btn-ghost" download>
            <Download className="size-4" aria-hidden /> Review log CSV
          </a>
        }
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <RecData searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function RecData({ searchParams }: { searchParams: PageProps<"/recommendations">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const run = await getLatestRun(db);
  if (!run) return <NoRunYet />;
  const rows = (await getRunRecommendations(db, run.id)).sort(byPriority);
  const viewKey = typeof sp.view === "string" && VIEWS.some((v) => v.key === sp.view) ? sp.view : "pending";
  const view = VIEWS.find((v) => v.key === viewKey)!;
  const list = rows.filter(view.match);
  const recParam = typeof sp.rec === "string" ? Number(sp.rec) : NaN;
  const requested = Number.isFinite(recParam) ? rows.find((r) => r.id === recParam) : undefined;
  const selected = requested ?? list[0] ?? null;
  const decisions = selected ? await getDecisions(db, [selected.id]) : [];
  const staleRequest = Number.isFinite(recParam) && !requested;

  const qs = (v: string, rec?: number) => `/recommendations?view=${v}${rec ? `&rec=${rec}` : ""}`;

  return (
    <div className="space-y-4">
      {staleRequest ? (
        <Notice tone="warning" title="That recommendation belongs to an older run">
          It has been superseded by run #{run.id}. Its history is still visible on the SKU page.
        </Notice>
      ) : null}
      <nav aria-label="Queue views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const count = rows.filter(v.match).length;
          const on = v.key === viewKey;
          return (
            <Link key={v.key} href={qs(v.key)} aria-current={on ? "page" : undefined} className={cn("rn-btn", on ? "rn-btn-primary" : "rn-btn-ghost")}>
              {v.label} <span className={cn("tabular rounded-full px-1.5 text-xs", on ? "bg-white/20" : "bg-white/10")}>{count}</span>
            </Link>
          );
        })}
      </nav>
      <p className="text-xs text-ink-3">
        Run #{run.id} · {fmtDateTime(run.createdAt)} · triggered by {run.triggeredBy}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="rn-card rn-rise max-h-[75vh] overflow-auto p-2">
          {list.length === 0 ? (
            <p className="p-4 text-sm text-ink-3">{viewKey === "pending" ? "Nothing is waiting for review." : "No items in this view."}</p>
          ) : (
            <ul className="space-y-1">
              {list.map((r) => {
                const on = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <Link
                      href={qs(viewKey, r.id)}
                      scroll={false}
                      aria-current={on ? "true" : undefined}
                      className={cn("block rounded-lg border px-3 py-2.5 transition-colors", on ? "border-accent/60 bg-accent/[0.08]" : "border-transparent hover:bg-white/[0.04]")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-1">{r.skuName}</p>
                          <p className="text-xs text-ink-3">
                            {r.skuId} · {r.weeksOfStock === null ? "cover n/a" : `${fmtNum(r.weeksOfStock, 1)} wks`}
                          </p>
                        </div>
                        <ReviewPill value={r.reviewStatus} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <ActionPill value={r.action} />
                        {r.exceptionCodes.length ? <span className="text-[0.6875rem] text-ink-3">{r.exceptionCodes.length} exception(s)</span> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected ? (
          <div className="space-y-4">
            <Card
              title={
                <span>
                  {selected.skuName} <span className="text-sm font-normal text-ink-3">· {selected.skuId}</span>
                </span>
              }
              description={`${selected.category} · ${selected.perishability} perishability · ${selected.distributorName ?? "unmapped distributor"}${selected.region ? ` (${selected.region})` : ""}`}
              actions={
                <Link href={`/skus/${encodeURIComponent(selected.skuId)}`} className="rn-btn rn-btn-ghost py-1.5 text-xs">
                  Full calculation <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            >
              <div className="mb-4 flex flex-wrap gap-1.5">
                <DemandPill value={selected.demandClass} />
                <RiskPill value={selected.inventoryRisk} />
                <ActionPill value={selected.action} />
                {selected.exceptionCodes.map((c) => (
                  <ExceptionPill key={c} code={c} />
                ))}
              </div>
              <p className="mb-4 rounded-lg border border-line bg-white/[0.02] p-3 text-sm leading-relaxed text-ink-2">{selected.reason}</p>
              <ReviewPanel
                key={selected.id}
                recommendationId={selected.id}
                calculatedQty={selected.recommendedQty}
                calculatedQtyRaw={selected.recommendedQtyRaw}
                standardReorderQty={selected.standardReorderQty}
                unit={selected.unitOfMeasure}
                status={selected.reviewStatus}
                finalQty={selected.finalQty}
                decisions={decisions}
              />
            </Card>
            <AiExplanationPanel key={`ai-${selected.id}`} recommendationId={selected.id} />
          </div>
        ) : (
          <EmptyState title="Select a recommendation">Choose an item from the list to review it.</EmptyState>
        )}
      </div>
    </div>
  );
}
