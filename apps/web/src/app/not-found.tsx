import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SailoMark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" />

      <div className="animate-rise relative">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-md">
          <SailoMark className="size-7" />
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          This shop doesn&rsquo;t exist
        </h1>
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-ink-500">
          The link may be wrong, or the owner has taken their page offline.
        </p>
        <Link
          href="/"
          className="focus-ring press group mt-7 inline-flex h-12 items-center gap-2 rounded-2xl bg-brand-700 px-6 text-sm font-semibold text-white shadow-md transition hover:bg-brand-600"
        >
          Create your own shop
          <ArrowRight className="size-4 transition-transform duration-300 ease-[var(--ease-out-quint)] group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
