import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleHelp,
  Clock,
  Eye,
  Minus,
  PauseCircle,
  PencilLine,
  RefreshCw,
  TrendingUp,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ACTION_LABEL, DEMAND_LABEL, EXCEPTION_INFO, RISK_LABEL, type DemandClass, type ExceptionCode, type InventoryRisk, type RecommendationAction } from "@/lib/rules/engine";
import { cn } from "./ui";

type Tone = "critical" | "warning" | "serious" | "good" | "info" | "muted";

const TONE: Record<Tone, string> = {
  critical: "border-critical/40 bg-critical/10 text-[#ffc2c9]",
  warning: "border-warning/40 bg-warning/10 text-[#ffe2a6]",
  serious: "border-serious/40 bg-serious/10 text-[#ffd0bd]",
  good: "border-good/35 bg-good/10 text-[#b7f5cb]",
  info: "border-info/35 bg-info/10 text-[#cfe0ff]",
  muted: "border-white/10 bg-white/[0.04] text-ink-2",
};
const ICON_TONE: Record<Tone, string> = {
  critical: "text-critical",
  warning: "text-warning",
  serious: "text-serious",
  good: "text-good",
  info: "text-info",
  muted: "text-ink-3",
};

export function Pill({ tone, icon: Icon, children, title }: { tone: Tone; icon: LucideIcon; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      <Icon className={cn("size-3.5 shrink-0", ICON_TONE[tone])} aria-hidden />
      {children}
    </span>
  );
}

const DEMAND: Record<DemandClass, [Tone, LucideIcon]> = {
  high_demand: ["warning", TrendingUp],
  normal: ["muted", Minus],
  insufficient_data: ["info", CircleHelp],
};
export function DemandPill({ value }: { value: DemandClass }) {
  const [tone, icon] = DEMAND[value];
  return <Pill tone={tone} icon={icon}>{DEMAND_LABEL[value]}</Pill>;
}

const RISK: Record<InventoryRisk, [Tone, LucideIcon]> = {
  stockout_risk: ["critical", AlertTriangle],
  perishable_below_min: ["critical", AlertTriangle],
  overstock_risk: ["serious", Archive],
  perishable_above_max: ["serious", Archive],
  within_range: ["good", CheckCircle2],
  no_recent_demand: ["info", CircleHelp],
  insufficient_data: ["info", CircleHelp],
};
export function RiskPill({ value }: { value: InventoryRisk }) {
  const [tone, icon] = RISK[value];
  return (
    <Pill tone={tone} icon={icon} title="Projected risk flag from the rules, not a confirmed stockout or write-off">
      {RISK_LABEL[value]}
    </Pill>
  );
}

const ACTION: Record<RecommendationAction, [Tone, LucideIcon]> = {
  REORDER_IMMEDIATE: ["critical", Zap],
  REORDER: ["warning", RefreshCw],
  PAUSE_NEXT_ORDER: ["serious", PauseCircle],
  REVIEW_REQUIRED: ["info", Eye],
  NO_ACTION: ["muted", Minus],
};
export function ActionPill({ value }: { value: RecommendationAction }) {
  const [tone, icon] = ACTION[value];
  return <Pill tone={tone} icon={icon}>{ACTION_LABEL[value]}</Pill>;
}

export const REVIEW_LABEL = { pending: "Pending review", approved: "Approved", edited: "Edited", rejected: "Rejected", not_required: "No review needed" } as const;
const REVIEW: Record<keyof typeof REVIEW_LABEL, [Tone, LucideIcon]> = {
  pending: ["warning", Clock],
  approved: ["good", CheckCircle2],
  edited: ["info", PencilLine],
  rejected: ["critical", XCircle],
  not_required: ["muted", Minus],
};
export function ReviewPill({ value }: { value: keyof typeof REVIEW_LABEL }) {
  const [tone, icon] = REVIEW[value];
  return <Pill tone={tone} icon={icon}>{REVIEW_LABEL[value]}</Pill>;
}

const EXC_TONE = { data: "info", policy: "warning", conflict: "critical", attention: "serious" } as const;
export function ExceptionPill({ code }: { code: ExceptionCode }) {
  const info = EXCEPTION_INFO[code];
  if (!info) return null;
  return (
    <Pill tone={EXC_TONE[info.kind]} icon={info.kind === "conflict" ? AlertTriangle : info.kind === "data" ? CircleHelp : Eye} title={info.description}>
      {info.label}
    </Pill>
  );
}
