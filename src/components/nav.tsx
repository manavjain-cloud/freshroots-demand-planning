"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChartLine, ClipboardCheck, LayoutDashboard, Menu, PackageSearch, SlidersHorizontal, Table2, Upload, X } from "lucide-react";
import { cn } from "./ui";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/planning", label: "Demand Planning", icon: Table2 },
  { href: "/skus", label: "SKU Explorer", icon: PackageSearch },
  { href: "/recommendations", label: "Recommendations", icon: ClipboardCheck },
  { href: "/insights", label: "Insights & Reports", icon: ChartLine },
  { href: "/imports", label: "Data Imports", icon: Upload },
  { href: "/settings", label: "Rules & Settings", icon: SlidersHorizontal },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#7a0f22] font-display text-sm font-extrabold text-white shadow-[0_0_24px_-6px_rgba(239,35,60,0.8)]" aria-hidden>
        F
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-bold text-ink-1">Freshroots</span>
        <span className="block text-[0.6875rem] text-ink-3">Demand Planning</span>
      </span>
    </Link>
  );
}

function StaticNavLinks() {
  return (
    <ul className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-white/[0.04] hover:text-ink-1">
            <Icon className="size-4 text-ink-3" aria-hidden />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent/[0.12] text-ink-1" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink-1",
              )}
            >
              {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent shadow-[0_0_10px_rgba(239,35,60,0.9)]" aria-hidden /> : null}
              <Icon className={cn("size-4", active ? "text-accent" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const Footer = () => (
  <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-[0.6875rem] leading-relaxed text-ink-3">
    Decision support only. Approvals here never create or send purchase orders.
  </div>
);

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-[#070506]/80 px-3 py-5 backdrop-blur lg:flex">
      <div className="px-2">
        <Brand />
      </div>
      <nav aria-label="Main" className="mt-8 flex-1">
        <Suspense fallback={<StaticNavLinks />}>
          <NavLinks />
        </Suspense>
      </nav>
      <Footer />
    </aside>
  );
}

export function MobileNav() {
  return (
    <Suspense
      fallback={
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
        </header>
      }
    >
      <MobileNavInner />
    </Suspense>
  );
}

function MobileNavInner() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const current = NAV.find((n) => isActive(pathname, n.href));
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
      <Brand />
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-3">{current?.label}</span>
        <button type="button" className="rn-btn rn-btn-ghost px-2.5" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 top-[61px] z-40 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <nav id="mobile-nav" aria-label="Main" className="border-b border-line bg-surface-1 p-3" onClick={(e) => e.stopPropagation()}>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-3">
              <Footer />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
