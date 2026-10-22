import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader, PageSkeleton, Unavailable } from "@/components/ui";
import { ActionPill, DemandPill, RiskPill } from "@/components/pills";
import { DbMissing } from "@/components/states";
import { Sparkline } from "@/components/charts";
import { dbOrNull } from "@/lib/server/page";
import { getAllSalesSeries, getLatestRun, getRunRecommendations, listSkuOptions } from "@/lib/server/queries";
import { fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "SKU Explorer" };

export default function SkusPage() {
  return (
    <>
      <PageHeader eyebrow="SKU Explorer" title="SKU explorer" description="Every SKU with its 16-week sales trend and latest classification. Open a SKU to see the underlying calculations, rules and review history." />
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <SkuGrid />
      </Suspense>
    </>
  );
}

async function SkuGrid() {
  await connection();
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const [skus, series, run] = await Promise.all([listSkuOptions(db), getAllSalesSeries(db), getLatestRun(db)]);
  const recs = run ? await getRunRecommendations(db, run.id) : [];
  const recBy = new Map(recs.map((r) => [r.skuId, r]));
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {skus.map((s) => {
        const r = recBy.get(s.skuId);
        const values = (series.get(s.skuId) ?? []).map((x) => x.units);
        return (
          <li key={s.skuId}>
            <Link href={`/skus/${encodeURIComponent(s.skuId)}`} className="rn-card rn-card-hover rn-rise flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-1">{s.skuName}</p>
                  <p className="text-xs text-ink-3">
                    {s.skuId} · {s.category} · <span className={s.perishability === "High" ? "text-warning" : undefined}>{s.perishability} perishability</span>
                  </p>
                </div>
                <Sparkline values={values} className="h-8 w-28 shrink-0" />
              </div>
              {r ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    <DemandPill value={r.demandClass} />
                    <RiskPill value={r.inventoryRisk} />
                    <ActionPill value={r.action} />
                  </div>
                  <dl className="tabular mt-auto grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-ink-3">Latest wk</dt>
                      <dd className="text-ink-1">{fmtNum(r.latestWeekUnits)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Stock</dt>
                      <dd className="text-ink-1">{fmtNum(r.currentStock)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Wks of stock</dt>
                      <dd className="text-ink-1">{fmtNum(r.weeksOfStock, 1)}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <Unavailable label="Not in a run yet" />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
