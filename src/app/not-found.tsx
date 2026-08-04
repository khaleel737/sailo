import Link from "next/link";
import { Store } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-ink-900 text-white">
        <Store className="size-5" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        This shop doesn&rsquo;t exist
      </h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        The link may be wrong, or the owner has taken their page offline.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-ink-900 px-5 text-sm font-medium text-white transition hover:bg-ink-800"
      >
        Create your own shop
      </Link>
    </div>
  );
}
