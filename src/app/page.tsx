import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Filter,
  MessageCircle,
  Search,
  Star,
  Store,
  Upload,
} from "lucide-react";
import { getSession } from "@/lib/session";

const FEATURES = [
  {
    icon: Upload,
    title: "Upload anything",
    body: "Physical goods, digital downloads or services. One template renders all three.",
  },
  {
    icon: Search,
    title: "Search & filters built in",
    body: "Categories, price range, type and sort — so a hundred products stay browsable.",
  },
  {
    icon: MessageCircle,
    title: "Orders on WhatsApp",
    body: "No checkout to configure, no payout account, no country restrictions. Buyers tap Order, you get the message.",
  },
  {
    icon: Star,
    title: "Reviews that build trust",
    body: "Buyers rate what they bought. You approve what goes live.",
  },
  {
    icon: Filter,
    title: "Know what's working",
    body: "Visits, orders and clients — the numbers that matter, nothing you'd never read.",
  },
  {
    icon: Store,
    title: "One link, one template",
    body: "Set it up once. Change your logo, colours and socials whenever you like.",
  },
];

export default async function HomePage() {
  if (await getSession()) redirect("/admin");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <span className="inline-flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink-900 text-white">
            <Store className="size-4" />
          </span>
          <span className="font-semibold tracking-tight">Shopik</span>
        </span>
        <nav className="flex items-center gap-1">
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
          >
            Create shop
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-16 text-center sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
            Free while in beta
          </p>
          <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            Your bio link,
            <br />
            but it&rsquo;s a shop.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-ink-600 sm:text-lg">
            Shopik is as simple as a link-in-bio page — except the rows are your
            products. Upload what you sell, share one link, take orders on
            WhatsApp.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-6 font-medium text-white transition hover:bg-ink-800 sm:w-auto"
            >
              Create your shop
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-ink-200 bg-white px-6 font-medium text-ink-900 transition hover:bg-ink-50 sm:w-auto"
            >
              See a live example
            </Link>
          </div>

          <p className="mt-4 text-sm text-ink-400">
            No card required · No checkout setup · Works in every country
          </p>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 pb-24">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-ink-200 bg-white p-5"
              >
                <feature.icon className="size-5 text-ink-400" />
                <h2 className="mt-3 text-sm font-semibold">{feature.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-ink-200 bg-ink-50">
          <div className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Selling from your DMs already works.
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-ink-600">
              Shopik just gives it a front door — so people can browse, search
              and see prices before they message you.
            </p>
            <Link
              href="/signup"
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink-900 px-6 font-medium text-white transition hover:bg-ink-800"
            >
              Get your link
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-ink-500">
          <span>© {new Date().getFullYear()} Shopik</span>
          <Link href="/login" className="transition hover:text-ink-900">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
