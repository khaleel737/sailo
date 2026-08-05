import Image from "next/image";
import { MapPin, Store } from "lucide-react";
import type { Shop } from "@/db/schema";
import { SocialIcons } from "./social-icons";

/**
 * The seller's identity: avatar or logo, name, description, location, socials.
 *
 * `dir="auto"` on the seller's own words rather than the page's direction —
 * an Arabic shop name inside an English storefront still has to read
 * right-to-left, and only the browser can tell which way each string runs.
 */
export function ShopHeader({ shop }: { shop: Shop }) {
  return (
    <header className="flex flex-col items-center text-center">
      {shop.avatarUrl ? (
        <Image
          src={shop.avatarUrl}
          alt={shop.name}
          width={96}
          height={96}
          className="size-24 rounded-full object-cover"
          priority
        />
      ) : (
        <div className="accent-bg flex size-24 items-center justify-center rounded-full">
          <Store className="size-9" />
        </div>
      )}

      {shop.logoUrl ? (
        <Image
          src={shop.logoUrl}
          alt={`${shop.name} logo`}
          width={160}
          height={40}
          className="mt-4 h-8 w-auto object-contain"
        />
      ) : (
        <h1
          dir="auto"
          className="mt-4 text-xl font-bold tracking-tight sm:text-2xl"
        >
          {shop.name}
        </h1>
      )}

      {shop.description ? (
        <p dir="auto" className="text-muted mt-2 max-w-md text-sm leading-relaxed">
          {shop.description}
        </p>
      ) : null}

      {shop.location ? (
        <p className="text-muted mt-2 inline-flex items-center gap-1 text-xs">
          <MapPin className="size-3.5" />
          {shop.location}
        </p>
      ) : null}

      <div className="mt-5">
        <SocialIcons socials={shop.socials} />
      </div>
    </header>
  );
}
