import { Ghost, Globe, Send, type LucideIcon } from "lucide-react";
import {
  Facebook,
  Instagram,
  Pinterest,
  TikTok,
  WhatsApp,
  XMark,
  YouTube,
  type BrandIconProps,
} from "@/components/shared/brand-icons";
import type { ShopSocial } from "@sailo/db/schema";
import { OutboundLink } from "./outbound-link";

/**
 * Exported so the admin's payment rails can show the same marks the storefront
 * does — a WhatsApp rail labelled with a generic speech bubble reads as a
 * different product from the button the buyer eventually taps.
 */
export const PLATFORM_ICONS: Record<
  string,
  LucideIcon | ((p: BrandIconProps) => React.ReactElement)
> = {
  instagram: Instagram,
  tiktok: TikTok,
  x: XMark,
  youtube: YouTube,
  facebook: Facebook,
  whatsapp: WhatsApp,
  telegram: Send,
  snapchat: Ghost,
  pinterest: Pinterest,
  website: Globe,
};

const LABELS: Record<string, string> = {
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  website: "Website",
};

export function SocialIcons({
  socials,
  shopId,
}: {
  socials: ShopSocial[];
  /** When present, each icon counts an outbound click for this shop. */
  shopId?: string;
}) {
  if (!socials?.length) return null;

  return (
    <ul className="flex flex-wrap items-center justify-center gap-2">
      {socials.map((social) => {
        const Icon = PLATFORM_ICONS[social.platform] ?? Globe;
        const label =
          LABELS[social.platform] ??
          social.platform.charAt(0).toUpperCase() + social.platform.slice(1);

        const anchor = {
          href: social.url,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          "aria-label": label,
          title: label,
          className:
            "surface-card flex size-9 items-center justify-center rounded-full transition hover:opacity-70",
        };

        return (
          <li key={`${social.platform}-${social.url}`}>
            {shopId ? (
              <OutboundLink
                shopId={shopId}
                // A "website" entry is the seller's own other site, not a
                // social network; it still counts, filed under other.
                kind={social.platform === "website" ? "other" : "social"}
                {...anchor}
              >
                <Icon className="size-4" />
              </OutboundLink>
            ) : (
              <a {...anchor}>
                <Icon className="size-4" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
