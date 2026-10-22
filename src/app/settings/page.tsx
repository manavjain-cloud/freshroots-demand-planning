import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Bot, CheckCircle2, CircleHelp, Database, KeyRound, Plug, TriangleAlert } from "lucide-react";
import { Card, Notice, PageHeader, PageSkeleton } from "@/components/ui";
import { DbMissing } from "@/components/states";
import { ConfigForm } from "@/components/config-form";
import { dbOrNull } from "@/lib/server/page";
import { getActiveConfig } from "@/lib/server/runs";
import { getAuditLog, listRuleConfigs } from "@/lib/server/queries";
import { aiStatus } from "@/lib/server/ai";
import { getZohoStatus, ZOHO_READ_SCOPES, ZOHO_REQUIRED_ENV } from "@/lib/integrations/zoho";
import { getLatestZohoSyncs } from "@/lib/server/zoho-sync";
import { ZohoActions } from "@/components/zoho-panel";
import { NINE_CHECKS, OPEN_POLICY_DECISIONS, OWNERSHIP, PRE_BUILD_DECISIONS, RULE_PRECEDENCE } from "@/lib/governance";
import { ENGINE_VERSION } from "@/lib/rules/config";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Rules & Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Rules & Settings"
        title="Rules, integrations and governance"
        description="The single rule configuration used by every run, how conflicts are resolved, which policy questions remain open, and the pilot's guardrails."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <SettingsData />
      </Suspense>
    </>
  );
}

function Status({ ok, warn, label }: { ok?: boolean; warn?: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : warn ? TriangleAlert : CircleHelp;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? "text-good" : warn ? "text-warning" : "text-ink-3"}`}>
      <Icon className="size-3.5" aria-hidden /> {label}
    </span>
  );
}

async function SettingsData() {
  await connection();
  const db = dbOrNull();
  if (!db) return <DbMissing />;
  const [active, history, audit] = await Promise.all([getActiveConfig(db), listRuleConfigs(db, 10), getAuditLog(db, 40)]);
  const ai = aiStatus();
  const zoho = getZohoStatus();
  const zohoSyncs = await getLatestZohoSyncs(db);
  const basicAuth = !!process.env.BASIC_AUTH_USER && !!process.env.BASIC_AUTH_PASSWORD;

  return (
    <div className="space-y-6">
      <Card
        title="Active rule configuration"
        description={active.id ? `Version ${active.id} · saved ${fmtDateTime(active.createdAt)}${active.note ? ` · “${active.note}”` : ""} · engine v${ENGINE_VERSION}` : "Case defaults (not yet saved)"}
      >
        <ConfigForm config={active.config} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Rule precedence" description="Deterministic order applied by the rule engine when signals conflict">
          <ol className="space-y-2">
            {RULE_PRECEDENCE.map((p) => (
              <li key={p.code} className="flex gap-3 rounded-lg border border-line bg-white/[0.02] p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 font-display text-xs font-bold text-accent">{p.code}</span>
                <div>
                  <p className="text-sm font-medium text-ink-1">{p.label}</p>
                  <p className="text-[0.8125rem] text-ink-2">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Open policy decisions" description="Where the case is silent. Current behaviour is a documented default awaiting planner sign-off.">
          <ul className="space-y-2">
            {OPEN_POLICY_DECISIONS.map((d) => (
              <li key={d.id} className="rounded-lg border border-line bg-white/[0.02] p-3">
                <p className="text-sm font-medium text-ink-1">
                  <span className="mr-1.5 text-xs text-accent">{d.id}</span>
                  {d.question}
                </p>
                <p className="text-[0.8125rem] text-ink-2">Current: {d.current}</p>
                <p className="text-xs text-ink-3">{d.why}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Integrations and access" description="Status is checked from the server configuration. No credentials are shown.">
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <li className="rounded-lg border border-line bg-white/[0.02] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
              <Database className="size-4 text-ink-3" aria-hidden /> Neon PostgreSQL
            </p>
            <Status ok label="Connected" />
            <p className="mt-1 text-xs text-ink-3">Stores imports, runs, recommendations, reviews and the audit log.</p>
          </li>
          <li className="rounded-lg border border-line bg-white/[0.02] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
              <Bot className="size-4 text-ink-3" aria-hidden /> Gemini (AI explanations)
            </p>
            <Status ok={ai.configured} warn={!ai.configured} label={ai.configured ? `Configured · ${ai.model} via ${ai.provider === "openrouter" ? "OpenRouter" : "Gemini API"}` : "Not configured"} />
            <p className="mt-1 text-xs text-ink-3">Explanations and summaries only. Never sets quantities, classifications or approvals.</p>
          </li>
          <li className="rounded-lg border border-line bg-white/[0.02] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
              <Plug className="size-4 text-ink-3" aria-hidden /> Zoho Inventory
            </p>
            <Status
              ok={zohoSyncs.latest?.status === "succeeded"}
              warn={zohoSyncs.latest?.status !== "succeeded"}
              label={zoho.state === "not_configured" ? "Not connected" : zohoSyncs.latest ? (zohoSyncs.latest.status === "succeeded" ? "Read-only · synced" : "Last sync failed") : "Configured · not synced yet"}
            />
            <p className="mt-1 text-xs text-ink-3">{zoho.message} See the Zoho section below.</p>
          </li>
          <li className="rounded-lg border border-line bg-white/[0.02] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
              <KeyRound className="size-4 text-ink-3" aria-hidden /> Authentication
            </p>
            <Status warn label={basicAuth ? "Shared access password only" : "Not configured"} />
            <p className="mt-1 text-xs text-ink-3">
              {basicAuth ? "A shared HTTP Basic password protects the site, but it does not identify individual reviewers." : "Prototype review mode: anyone with the link can review."} Reviewer names are self-declared and stored as unverified.
            </p>
          </li>
        </ul>
      </Card>

      <Card
        id="zoho"
        title="Zoho Inventory (read-only)"
        description="Reads items, purchase orders and purchase receives to show stock on order and an observed lead time per SKU. Never writes to Zoho; rules still use on-hand stock only."
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3 text-[0.8125rem] text-ink-2">
            {zoho.state === "not_configured" ? (
              <Notice tone="warning" title="Not connected">
                Missing: {zoho.missing.join(", ")}. Read-only scopes needed: {ZOHO_READ_SCOPES.join(", ")}. Setup steps are in docs/zoho-setup.md.
              </Notice>
            ) : null}
            {zohoSyncs.latest ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-xs text-ink-3">Last sync</dt>
                  <dd className="text-ink-1">
                    #{zohoSyncs.latest.id} · {zohoSyncs.latest.status} · {fmtDateTime(zohoSyncs.latest.finishedAt ?? zohoSyncs.latest.startedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Items mapped to SKUs</dt>
                  <dd className="tabular text-ink-1">
                    {zohoSyncs.latest.itemsMapped} of {zohoSyncs.latest.itemsSeen}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Purchase orders read</dt>
                  <dd className="tabular text-ink-1">
                    {zohoSyncs.latest.purchaseOrdersSeen} ({zohoSyncs.latest.poDetailsFetched} in detail)
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Open PO lines · lead-time observations</dt>
                  <dd className="tabular text-ink-1">
                    {zohoSyncs.latest.openPoLines} · {zohoSyncs.latest.leadTimeObservations}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">API calls used</dt>
                  <dd className="tabular text-ink-1">{zohoSyncs.latest.apiCalls}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">PO statuses seen</dt>
                  <dd className="text-ink-1">{zohoSyncs.latest.statusValuesSeen.join(", ") || "—"}</dd>
                </div>
              </dl>
            ) : zoho.state === "configured" ? (
              <p>Credentials are set. Run a sync to load purchase orders and lead times.</p>
            ) : null}
            {zohoSyncs.latest?.error ? <Notice tone="critical" title="Sync error">{zohoSyncs.latest.error}</Notice> : null}
            {zohoSyncs.latest?.warnings.length ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-warning">
                {zohoSyncs.latest.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
            {zohoSyncs.lastSuccess && zohoSyncs.latest?.id !== zohoSyncs.lastSuccess.id ? (
              <p className="text-xs text-ink-3">Pages keep showing data from the last successful sync (#{zohoSyncs.lastSuccess.id}).</p>
            ) : null}
          </div>
          <div className="space-y-3 text-[0.8125rem] text-ink-2">
            <ZohoActions configured={zoho.state === "configured"} />
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-3">
              <li>Zoho items are matched to Freshroots SKUs by their SKU field (e.g. SKU001).</li>
              <li>“On order” = ordered minus received on purchase orders that are not draft, awaiting approval, cancelled or closed.</li>
              <li>Observed lead time = days from PO date to first goods receipt, median of past POs. Zoho has no supplier lead-time field.</li>
              <li>Required settings: {ZOHO_REQUIRED_ENV.join(", ")} (+ ZOHO_ACCOUNTS_DOMAIN / ZOHO_API_DOMAIN outside India).</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Nine Checks" description="Product guardrails for this pilot">
          <ul className="space-y-2">
            {NINE_CHECKS.map((c) => (
              <li key={c.check} className="rounded-lg border border-line bg-white/[0.02] p-3">
                <p className="text-sm font-medium text-ink-1">
                  <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-3">{c.group}</span>
                  {c.check}
                </p>
                <p className="text-[0.8125rem] text-ink-2">{c.answer}</p>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Pre-build decisions">
            <ul className="space-y-2">
              {PRE_BUILD_DECISIONS.map((d) => (
                <li key={d.title} className="rounded-lg border border-line bg-white/[0.02] p-3">
                  <p className="text-sm font-medium text-ink-1">{d.title}</p>
                  <p className="text-[0.8125rem] text-ink-2">{d.body}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Ownership" description="Proposed owners are not confirmed until the project owner agrees">
            <div className="overflow-x-auto">
              <table className="rn-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Owner</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {OWNERSHIP.map((o) => (
                    <tr key={o.area}>
                      <td className="text-ink-1">{o.area}</td>
                      <td className="text-[0.8125rem]">{o.owner}</td>
                      <td className="text-xs text-ink-3">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Configuration history">
          <ul className="space-y-2">
            {history.length === 0 ? <li className="text-sm text-ink-3">No saved versions yet.</li> : null}
            {history.map((h) => (
              <li key={h.id} className="rounded-lg border border-line bg-white/[0.02] p-3 text-[0.8125rem]">
                <p className="font-medium text-ink-1">
                  v{h.id} {h.isActive ? <span className="ml-1 text-xs text-good">active</span> : null}
                </p>
                <p className="text-ink-2">{h.note ?? "—"}</p>
                <p className="text-xs text-ink-3">
                  {h.createdBy} · {fmtDateTime(h.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Audit log" description="Imports, runs, reviews and configuration changes">
          <div className="max-h-96 overflow-auto">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(a.occurredAt)}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td className="text-xs">
                      {a.entityType} {a.entityId ? `#${a.entityId}` : ""}
                    </td>
                    <td className="max-w-[200px] truncate text-xs text-ink-3" title={a.actor}>
                      {a.actor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Notice>Approving a recommendation records a review decision only. This version reads from Zoho but cannot create, send or change purchase orders.</Notice>
    </div>
  );
}
