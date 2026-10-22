import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { CheckCircle2, CircleHelp, Download, TriangleAlert, XCircle } from "lucide-react";
import { Card, PageHeader, PageSkeleton } from "@/components/ui";
import { DbMissing } from "@/components/states";
import { ImportPanel } from "@/components/import-panel";
import { dbOrNull } from "@/lib/server/page";
import { getBatchErrors, getDataHealth, listImportBatches } from "@/lib/server/queries";
import { DATASET_INFO } from "@/lib/imports/validate";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "Data Imports" };

export default function ImportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Data Imports"
        title="Data imports and quality"
        description="Load and validate the five input files. Every import is recorded with its original rows, a file hash and any row-level errors, so invalid data never reaches the calculations silently."
        actions={
          <a href="/api/export/data-quality" className="rn-btn rn-btn-ghost" download>
            <Download className="size-4" aria-hidden /> Data-quality CSV
          </a>
        }
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <ImportsData />
      </Suspense>
    </>
  );
}

const STATUS_ICON = {
  pass: [CheckCircle2, "text-good", "Pass"],
  warn: [TriangleAlert, "text-warning", "Warning"],
  fail: [XCircle, "text-critical", "Fail"],
  info: [CircleHelp, "text-info", "Info"],
} as const;

async function ImportsData() {
  await connection();
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const [health, batches] = await Promise.all([getDataHealth(db), listImportBatches(db, 30)]);
  const rejected = batches.filter((b) => b.status === "rejected").slice(0, 3);
  const rejectedErrors = await Promise.all(rejected.map(async (b) => ({ batch: b, errors: await getBatchErrors(db, b.id) })));

  return (
    <div className="space-y-6">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {health.datasets.map((d) => (
          <li key={d.dataset} className="rn-card rn-rise p-4">
            <p className="text-sm font-semibold text-ink-1">{d.label}</p>
            <p className="tabular mt-1 font-display text-2xl font-bold text-ink-1">{fmtNum(d.rowCount)}</p>
            <p className="text-xs text-ink-3">rows · grain {d.grain}</p>
            {d.lastBatch ? (
              <p className="mt-2 text-xs text-ink-2">
                Last import:{" "}
                <span className={d.lastBatch.status === "committed" ? "text-good" : "text-critical"}>{d.lastBatch.status}</span> · {fmtDateTime(d.lastBatch.createdAt)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-warning">Never imported</p>
            )}
            <p className="mt-1 truncate text-[0.6875rem] text-ink-3" title={DATASET_INFO[d.dataset].columns.join(", ")}>
              {DATASET_INFO[d.dataset].columns.join(", ")}
            </p>
          </li>
        ))}
      </ul>

      <Card title="Import data">
        <ImportPanel />
      </Card>

      <Card title="Data quality checklist" description={`Latest snapshot ${fmtDate(health.latestSnapshot?.asOfDate)} · sales through ${health.latestSalesWeek ?? "—"} · today ${fmtDate(health.today)} (IST)`}>
        <ul className="divide-y divide-line">
          {health.checks.map((c) => {
            const [Icon, cls, label] = STATUS_ICON[c.status];
            return (
              <li key={c.id} className="flex gap-3 py-2.5">
                <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-1">
                    {c.label} <span className={`ml-1 text-xs font-normal ${cls}`}>{label}</span>
                  </p>
                  <p className="text-[0.8125rem] text-ink-2">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {rejectedErrors.length ? (
        <Card title="Recent rejected imports" description="These files were not applied. Previously committed data is still in use.">
          <div className="space-y-4">
            {rejectedErrors.map(({ batch, errors }) => (
              <div key={batch.id}>
                <p className="text-sm font-medium text-ink-1">
                  #{batch.id} · {DATASET_INFO[batch.dataset].label} · {batch.fileName} · {fmtDateTime(batch.createdAt)}
                </p>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Rejected import errors, scrollable">
                  <table className="rn-table">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Column</th>
                        <th>Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errors.map((e, i) => (
                        <tr key={i}>
                          <td className="tabular">{e.rowNumber ?? "file"}</td>
                          <td className="text-xs">{e.column ?? "—"}</td>
                          <td className="text-xs">
                            <span className="font-mono text-[0.6875rem] text-ink-3">{e.code}</span> {e.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Import history" description="Most recent first">
        <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Import history, scrollable">
          <table className="rn-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Dataset</th>
                <th>File</th>
                <th>Status</th>
                <th className="text-right">Rows</th>
                <th className="text-right">New / upd. / same</th>
                <th>By</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="tabular">#{b.id}</td>
                  <td>{DATASET_INFO[b.dataset].label}</td>
                  <td className="max-w-[220px] truncate text-xs" title={b.fileName}>
                    {b.fileName} <span className="text-ink-3">({b.source})</span>
                  </td>
                  <td className={b.status === "committed" ? "text-good" : "text-critical"}>{b.status}</td>
                  <td className="tabular text-right">
                    {b.rowsTotal}
                    {b.rowsInvalid ? <span className="text-critical"> ({b.rowsInvalid} invalid)</span> : null}
                  </td>
                  <td className="tabular text-right text-xs">
                    {b.inserted} / {b.updated} / {b.unchanged}
                  </td>
                  <td className="max-w-[180px] truncate text-xs text-ink-3" title={b.importedBy}>
                    {b.importedBy}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
