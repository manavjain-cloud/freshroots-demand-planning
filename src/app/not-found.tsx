import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rn-card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold text-ink-1">Not found</h1>
      <p className="mt-2 text-sm text-ink-2">That page or SKU does not exist in the imported data.</p>
      <Link href="/" className="rn-btn rn-btn-ghost mt-5">
        Back to overview
      </Link>
    </div>
  );
}
