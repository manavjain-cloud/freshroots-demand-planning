import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CircleHelp, Info, type LucideIcon } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="rn-rise mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p> : null}
        <h1 className="text-2xl font-bold text-ink-1 md:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className, title, description, actions, id }: { children: ReactNode; className?: string; title?: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rn-card rn-rise p-4 md:p-5", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-ink-1">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "neutral" | "critical" | "warning" | "serious" | "good" | "info" | "accent";
  hint?: ReactNode;
  href?: string;
}) {
  const toneClass = {
    neutral: "text-ink-2 bg-white/5",
    critical: "text-critical bg-critical/10",
    warning: "text-warning bg-warning/10",
    serious: "text-serious bg-serious/10",
    good: "text-good bg-good/10",
    info: "text-info bg-info/10",
    accent: "text-accent bg-accent/10",
  }[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-ink-2">{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", toneClass)} aria-hidden>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="tabular mt-2 font-display text-[1.9rem] font-bold leading-none text-ink-1">{value}</div>
      {hint ? <p className="mt-2 text-xs leading-snug text-ink-3">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="rn-card rn-card-hover rn-rise block p-4">
      {body}
    </Link>
  ) : (
    <div className="rn-card rn-rise p-4">{body}</div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rn-skeleton", className)} aria-hidden />;
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-48" />
      ))}
    </div>
  );
}

export function Notice({ tone = "info", title, children, icon }: { tone?: "info" | "warning" | "critical"; title?: string; children: ReactNode; icon?: LucideIcon }) {
  const Icon = icon ?? (tone === "info" ? Info : AlertTriangle);
  const cls = {
    info: "border-info/30 bg-info/[0.06] text-ink-2",
    warning: "border-warning/35 bg-warning/[0.06] text-ink-2",
    critical: "border-critical/40 bg-critical/[0.07] text-ink-2",
  }[tone];
  const iconCls = { info: "text-info", warning: "text-warning", critical: "text-critical" }[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border px-3.5 py-3 text-[0.8125rem] leading-relaxed", cls)} role={tone === "critical" ? "alert" : undefined}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconCls)} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold text-ink-1">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action, icon: Icon = CircleHelp }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rn-card rn-rise flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-xl bg-white/5 text-ink-2" aria-hidden>
        <Icon className="size-5" />
      </span>
      <h2 className="text-base font-semibold text-ink-1">{title}</h2>
      {children ? <div className="mt-1.5 max-w-md text-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Explicit "unavailable" value — never a zero or an invented estimate. */
export function Unavailable({ label = "Not available", reason }: { label?: string; reason?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-3" title={reason}>
      <CircleHelp className="size-3.5" aria-hidden />
      <span className="text-[0.8125rem] font-medium">{label}</span>
    </span>
  );
}

export function Dl({ items, className }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-ink-3">{it.label}</dt>
          <dd className="tabular mt-0.5 text-sm font-medium text-ink-1">{it.value}</dd>
          {it.hint ? <dd className="mt-0.5 text-xs text-ink-3">{it.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
