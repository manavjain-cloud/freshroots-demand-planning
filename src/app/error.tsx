"use client";

import { TriangleAlert } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rn-card mx-auto mt-10 max-w-lg p-8 text-center">
      <TriangleAlert className="mx-auto mb-3 size-8 text-critical" aria-hidden />
      <h1 className="text-lg font-semibold text-ink-1">Something went wrong loading this page</h1>
      <p className="mt-2 text-sm text-ink-2">The database may be unavailable. No data was changed. Try again, or check the server logs.</p>
      <button type="button" className="rn-btn rn-btn-primary mt-5" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
