import { Database, PlayCircle } from "lucide-react";
import { EmptyState } from "./ui";

export function DbMissing() {
  return (
    <EmptyState title="Database not configured" icon={Database}>
      Set <code className="rounded bg-white/10 px-1">DATABASE_URL</code> to a Neon PostgreSQL connection string, then run{" "}
      <code className="rounded bg-white/10 px-1">npm run db:seed</code>. See the README for setup steps.
    </EmptyState>
  );
}

export function NoRunYet() {
  return (
    <EmptyState title="No demand planning run yet" icon={PlayCircle}>
      Use <strong>Run demand planning</strong> in the top bar to calculate classifications, risk flags and recommendations from the imported data.
    </EmptyState>
  );
}
