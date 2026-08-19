import type { Shop } from "@sailo/db/schema";

/**
 * The seller's own tracking tags, in one place: which providers exist, what a
 * real id for each looks like, and what each one stores on a buyer's device.
 *
 * Ids, never markup. A "paste your tracking snippet" box is a stored-XSS
 * feature with extra steps — on a multi-tenant platform it hands every seller
 * a `<script>` tag on pages our origin serves, one checkout away from other
 * people's money. So the seller gives us an identifier, the storefront builds
 * the script from a fixed template, and the shapes below are the security
 * boundary: an id that can only contain `[A-Z0-9-]` cannot close a quote,
 * open a tag, or become anything but the id it claims to be.
 *
 * Checked on the way in (`readPixelIds`, from the settings form) and again on
 * the way out (`pixelIdsOf`, before the storefront renders): the columns are
 * plain text, they hand back whatever was written — including by an older
 * build or a staff tool — and what they feed is a script tag.
 */

export type PixelProvider =
  | "ga4"
  | "gtm"
  | "meta"
  | "tiktok"
  | "googleAds"
  | "linkedin"
  | "pinterest";

/** One id per provider, or null where the seller left it empty. */
export type ShopPixelIds = Record<PixelProvider, string | null>;

/** The columns on `shops` that hold them — what `updateShop` writes. */
export type ShopPixelColumns = Pick<
  Shop,
  | "ga4MeasurementId"
  | "gtmContainerId"
  | "metaPixelId"
  | "tiktokPixelId"
  | "googleAdsId"
  | "linkedinPartnerId"
  | "pinterestTagId"
>;

type ProviderSpec = {
  /** Proper noun, identical in every language — the banner names tools. */
  name: string;
  /** The `shops` column the id lives in. */
  column: keyof ShopPixelColumns;
  /** The form field the settings card posts. */
  field: string;
  /**
   * What a real id looks like. Anything else is refused with `example`, never
   * stored — this is the whole injection defence, so keep it anchored and
   * keep the character class tight.
   */
  shape: RegExp;
  /** Shown beside a refusal, so the error teaches the right format. */
  example: string;
  /**
   * What it writes on the buyer's device once running — identifiers, not
   * prose, so the banner can disclose them without a dictionary entry. Empty
   * for Tag Manager: the container decides, so the tool name is the honest
   * disclosure and a guessed cookie list would be a claim we can't check.
   */
  stored: readonly string[];
  /**
   * The hosts this pixel needs, by CSP directive.
   *
   * Declared beside the id it belongs to rather than hand-kept in
   * `next.config.ts`, and that is the point: a provider added to this table
   * with no CSP entry is a pixel that loads, is blocked, and fails *silently*
   * — the seller's dashboard simply stays empty and nothing anywhere says
   * why. `pixelCspHosts` builds the header's list from here, so the two
   * cannot drift.
   */
  csp: {
    script?: readonly string[];
    img?: readonly string[];
    connect?: readonly string[];
  };
};

export const PIXEL_PROVIDERS: Record<PixelProvider, ProviderSpec> = {
  ga4: {
    name: "Google Analytics",
    column: "ga4MeasurementId",
    field: "pixelGa4",
    shape: /^G-[A-Z0-9]{4,20}$/,
    example: "G-ABC12DE3F4",
    stored: ["_ga", "_ga_*"],
    csp: {
      script: ["https://www.googletagmanager.com"],
      img: ["https://www.google-analytics.com", "https://www.googletagmanager.com"],
      connect: [
        "https://www.google-analytics.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://www.googletagmanager.com",
      ],
    },
  },
  gtm: {
    name: "Google Tag Manager",
    column: "gtmContainerId",
    field: "pixelGtm",
    shape: /^GTM-[A-Z0-9]{4,10}$/,
    example: "GTM-ABC123",
    stored: [],
    csp: {
      script: ["https://www.googletagmanager.com"],
      img: ["https://www.googletagmanager.com"],
      connect: ["https://www.googletagmanager.com"],
    },
  },
  meta: {
    name: "Meta Pixel",
    column: "metaPixelId",
    field: "pixelMeta",
    shape: /^[0-9]{5,20}$/,
    example: "123456789012345",
    stored: ["_fbp", "_fbc"],
    csp: {
      script: ["https://connect.facebook.net"],
      // The pixel's namesake fallback is an image request to /tr.
      img: ["https://www.facebook.com"],
      connect: ["https://www.facebook.com"],
    },
  },
  tiktok: {
    name: "TikTok Pixel",
    column: "tiktokPixelId",
    field: "pixelTiktok",
    shape: /^[A-Z0-9]{8,32}$/,
    example: "C1AB23CD45EF67GH89IJ",
    stored: ["_ttp"],
    csp: {
      script: ["https://analytics.tiktok.com"],
      img: ["https://analytics.tiktok.com"],
      connect: ["https://analytics.tiktok.com"],
    },
  },

  /* ------------------------------------------------------------------------
     Spec 42's three.

     Ad platforms a seller is already buying from — the id is the receipt for
     spend they made elsewhere, which is what separates these from a named
     analytics *product*. DataFast is refused for exactly that reason.
  ------------------------------------------------------------------------ */

  googleAds: {
    name: "Google Ads",
    column: "googleAdsId",
    field: "pixelGoogleAds",
    // `AW-123456789`. Digits only after the prefix — the whole injection
    // defence is that this cannot contain a quote, an angle bracket or a slash.
    shape: /^AW-[0-9]{6,15}$/,
    example: "AW-123456789",
    stored: ["_gcl_au"],
    csp: {
      script: ["https://www.googletagmanager.com", "https://www.googleadservices.com"],
      img: [
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
        "https://www.google.com",
      ],
      connect: ["https://www.googletagmanager.com", "https://www.googleadservices.com"],
    },
  },

  linkedin: {
    name: "LinkedIn Insight Tag",
    column: "linkedinPartnerId",
    field: "pixelLinkedIn",
    shape: /^[0-9]{4,12}$/,
    example: "1234567",
    stored: ["li_sugr", "bcookie", "lidc"],
    csp: {
      script: ["https://snap.licdn.com"],
      img: ["https://px.ads.linkedin.com", "https://p.adsymptotic.com"],
      connect: ["https://px.ads.linkedin.com"],
    },
  },

  pinterest: {
    name: "Pinterest Tag",
    column: "pinterestTagId",
    field: "pixelPinterest",
    shape: /^[0-9]{10,20}$/,
    example: "2612345678901",
    stored: ["_pinterest_ct_ua", "_pin_unauth"],
    csp: {
      script: ["https://s.pinimg.com"],
      img: ["https://ct.pinterest.com"],
      connect: ["https://ct.pinterest.com"],
    },
  },
};

export const PIXEL_PROVIDER_IDS = Object.keys(
  PIXEL_PROVIDERS,
) as PixelProvider[];

/**
 * A pasted value into a stored id, or a refusal that names the format.
 *
 * Uppercased before the check rather than matched case-insensitively: the
 * providers themselves issue uppercase ids, sellers paste them in any case,
 * and storing one canonical form means the storefront template and the
 * read-side check never meet a surprise.
 */
export function normalizePixelId(
  provider: PixelProvider,
  raw: FormDataEntryValue | null,
): { ok: true; id: string | null } | { ok: false } {
  const id = String(raw ?? "").trim().toUpperCase();
  if (!id) return { ok: true, id: null };
  return PIXEL_PROVIDERS[provider].shape.test(id)
    ? { ok: true, id }
    : { ok: false };
}

/**
 * Every pixel field of the settings form, validated into the columns to
 * write, or the error to show.
 *
 * A refusal, not a silent drop. Dropping a malformed paste would save the
 * rest of the form and leave the seller believing their campaign is measured
 * — they would only find out weeks later, in an empty dashboard, after the ad
 * money was spent.
 */
export function readPixelIds(
  formData: FormData,
): { ok: true; columns: ShopPixelColumns } | { ok: false; error: string } {
  const columns = {} as ShopPixelColumns;
  for (const provider of PIXEL_PROVIDER_IDS) {
    const spec = PIXEL_PROVIDERS[provider];
    const read = normalizePixelId(provider, formData.get(spec.field));
    if (!read.ok) {
      return {
        ok: false,
        error: `That doesn't look like a ${spec.name} ID — expected something like ${spec.example}.`,
      };
    }
    columns[spec.column] = read.id;
  }
  return { ok: true, columns };
}

/**
 * The shop row's pixel columns, re-checked before anything renders from them.
 * A stored value that no longer matches its shape is treated as absent rather
 * than trusted — the safe direction for a value that feeds a script tag.
 */
export function pixelIdsOf(shop: ShopPixelColumns): ShopPixelIds {
  const ids = {} as ShopPixelIds;
  for (const provider of PIXEL_PROVIDER_IDS) {
    const spec = PIXEL_PROVIDERS[provider];
    const stored = shop[spec.column];
    ids[provider] = stored && spec.shape.test(stored) ? stored : null;
  }
  return ids;
}

/** The providers this shop actually configured, for the banner and the tags. */
export function configuredPixels(
  ids: ShopPixelIds,
): { provider: PixelProvider; id: string; name: string; stored: readonly string[] }[] {
  return PIXEL_PROVIDER_IDS.flatMap((provider) => {
    const id = ids[provider];
    if (!id) return [];
    const { name, stored } = PIXEL_PROVIDERS[provider];
    return [{ provider, id, name, stored }];
  });
}

/** Whether this storefront runs any seller tag — and so must ask first. */
export function hasPixels(shop: ShopPixelColumns): boolean {
  return configuredPixels(pixelIdsOf(shop)).length > 0;
}

/**
 * Every host any supported pixel could need, by directive.
 *
 * **Derived, not hand-kept**, and that is the whole reason it exists: the four
 * hosts in `next.config.ts` were maintained by hand, and a provider added to
 * the table above without a matching entry there is a pixel that loads, is
 * blocked by the CSP, and fails *silently* — the seller's dashboard simply
 * stays empty and nothing says why.
 *
 * **This is a union, and the spec asks for a per-shop list.** It is a union
 * because the policy is a static response header and headers cannot tell
 * `/{handle}` from our own routes — the note in `next.config.ts` records that
 * decision for the two vendors already there. What actually gates a pixel is
 * unchanged and is stronger than an allowlist: the `<script>` is not rendered
 * at all unless the seller configured that provider *and* the buyer consented,
 * so a host named here for a shop that configured nothing is a permission
 * nothing uses. The residual gap is real and worth naming: a successful
 * injection on a storefront could reach these hosts. Closing it needs a
 * per-request policy, which this app's static shells do not have.
 */
export function pixelCspHosts(): {
  script: string[];
  img: string[];
  connect: string[];
} {
  const gather = (key: "script" | "img" | "connect") => [
    ...new Set(
      PIXEL_PROVIDER_IDS.flatMap((provider) => PIXEL_PROVIDERS[provider].csp[key] ?? []),
    ),
  ].toSorted();

  return { script: gather("script"), img: gather("img"), connect: gather("connect") };
}
