/**
 * Turning a raw pageview into something a seller can act on: where the visitor
 * came from, by what route, and on what.
 *
 * All of it is derived once on write. Parsing referrers at read time would mean
 * re-parsing every row on every dashboard load, and the answer never changes.
 */

/** How the visitor arrived. Ordered by how much the seller can act on it. */
export const TRAFFIC_SOURCES = [
  "campaign",
  "social",
  "search",
  "referral",
  "direct",
] as const;
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];

export const SOURCE_LABELS: Record<TrafficSource, string> = {
  campaign: "Campaigns",
  social: "Social",
  search: "Search",
  referral: "Other sites",
  direct: "Direct",
};

/**
 * Hosts we classify. Matched on the registrable-ish suffix so `m.facebook.com`,
 * `l.instagram.com` and `www.google.co.uk` all land in the right bucket.
 */
const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "tiktok.com", "twitter.com",
  "x.com", "t.co", "linkedin.com", "lnkd.in", "pinterest.com", "reddit.com",
  "snapchat.com", "whatsapp.com", "wa.me", "telegram.org", "t.me",
  "youtube.com", "youtu.be", "threads.net", "threads.com", "discord.com",
  "tumblr.com", "vk.com", "weibo.com", "line.me", "wechat.com", "kakao.com",
  "messenger.com", "quora.com", "medium.com", "twitch.tv", "mastodon.social",
  "bsky.app",
];

const SEARCH_HOSTS = [
  "google.", "bing.com", "duckduckgo.com", "yahoo.", "yandex.", "baidu.com",
  "ecosia.org", "brave.com", "search.brave.com", "startpage.com", "qwant.com",
  "naver.com", "seznam.cz", "ask.com", "aol.com", "perplexity.ai",
  "chatgpt.com", "openai.com", "gemini.google.com", "claude.ai",
];

/** Names the seller will recognise, for the ones that aren't obvious. */
const HOST_NAMES: Record<string, string> = {
  "t.co": "Twitter",
  "x.com": "X",
  "l.instagram.com": "Instagram",
  "lm.facebook.com": "Facebook",
  "lnkd.in": "LinkedIn",
  "wa.me": "WhatsApp",
  "t.me": "Telegram",
  "youtu.be": "YouTube",
  "fb.com": "Facebook",
};

/** Strips `www.`, `m.`, `l.` and the like so hosts group together. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(www|m|mobile|l|lm|out)\./, "");
}

function matches(host: string, needles: string[]) {
  return needles.some((n) =>
    n.endsWith(".") ? host.includes(n) : host === n || host.endsWith(`.${n}`),
  );
}

/**
 * A readable name for a referring host: "Instagram", "google.com".
 * Capitalises the brand where we know it, otherwise leaves the host alone —
 * guessing at an unknown domain's brand name reads worse than the domain.
 */
export function hostLabel(host: string | null): string {
  if (!host) return "Direct";
  const raw = host.toLowerCase();
  if (HOST_NAMES[raw]) return HOST_NAMES[raw];

  const clean = normalizeHost(raw);
  if (HOST_NAMES[clean]) return HOST_NAMES[clean];

  const known = [...SOCIAL_HOSTS, ...SEARCH_HOSTS].find((n) =>
    n.endsWith(".") ? clean.startsWith(n) : clean === n || clean.endsWith(`.${n}`),
  );
  const base = (known ?? clean).replace(/\.$/, "");
  const word = base.split(".")[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export type VisitOrigin = {
  referrer: string | null;
  referrerHost: string | null;
  source: TrafficSource;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

/**
 * Classifies a pageview.
 *
 * A UTM-tagged link wins over the referrer: the seller deliberately labelled
 * that link, and their label is more useful than "instagram.com".
 *
 * A referrer from the shop's own host is a same-site navigation, not a new
 * arrival, so it reads as direct rather than inventing a self-referral.
 */
export function classifyVisit(input: {
  referrer?: string | null;
  /** The landing URL, for its UTM query parameters. */
  url?: string | null;
  /** The shop's own host, so self-referrals aren't counted as traffic. */
  selfHost?: string | null;
}): VisitOrigin {
  let params: URLSearchParams | null = null;
  try {
    params = input.url ? new URL(input.url).searchParams : null;
  } catch {
    params = null;
  }

  const utm = (key: string) => {
    const value = params?.get(key)?.trim();
    return value ? value.slice(0, 120) : null;
  };
  const utmSource = utm("utm_source");
  const utmMedium = utm("utm_medium");
  const utmCampaign = utm("utm_campaign");

  let referrerHost: string | null = null;
  let referrer: string | null = null;
  try {
    if (input.referrer) {
      const parsed = new URL(input.referrer);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        referrer = input.referrer.slice(0, 500);
        referrerHost = normalizeHost(parsed.hostname);
      }
    }
  } catch {
    // A malformed referrer is no referrer.
  }

  const self = input.selfHost ? normalizeHost(input.selfHost) : null;
  if (referrerHost && self && referrerHost === self) {
    referrerHost = null;
    referrer = null;
  }

  const source: TrafficSource = utmSource || utmMedium || utmCampaign
    ? "campaign"
    : !referrerHost
      ? "direct"
      : matches(referrerHost, SEARCH_HOSTS)
        ? "search"
        : matches(referrerHost, SOCIAL_HOSTS)
          ? "social"
          : "referral";

  return { referrer, referrerHost, source, utmSource, utmMedium, utmCampaign };
}

export type DeviceInfo = {
  device: "mobile" | "tablet" | "desktop";
  os: string | null;
  browser: string | null;
};

/**
 * Enough user-agent parsing to answer "should I design for phones?" — which is
 * the only question a seller actually asks of this. Deliberately not a full UA
 * database: those need constant updating and this doesn't.
 */
export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { device: "desktop", os: null, browser: null };
  const s = ua.toLowerCase();

  const tablet = /ipad|tablet|playbook|silk/.test(s) ||
    (/android/.test(s) && !/mobile/.test(s));
  const mobile = !tablet && /mobi|iphone|ipod|android|blackberry|windows phone/.test(s);

  const os = /iphone|ipad|ipod/.test(s)
    ? "iOS"
    : /android/.test(s)
      ? "Android"
      : /mac os x|macintosh/.test(s)
        ? "macOS"
        : /windows/.test(s)
          ? "Windows"
          : /cros/.test(s)
            ? "ChromeOS"
            : /linux/.test(s)
              ? "Linux"
              : null;

  // Order matters: Edge and Opera both claim Chrome, Chrome claims Safari.
  const browser = /edg\//.test(s)
    ? "Edge"
    : /opr\/|opera/.test(s)
      ? "Opera"
      : /samsungbrowser/.test(s)
        ? "Samsung Internet"
        : /firefox|fxios/.test(s)
          ? "Firefox"
          : /chrome|crios/.test(s)
            ? "Chrome"
            : /safari/.test(s)
              ? "Safari"
              : null;

  return { device: tablet ? "tablet" : mobile ? "mobile" : "desktop", os, browser };
}

/** ISO 3166-1 alpha-2 → the flag emoji, by offsetting into the indicator block. */
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2 || !/^[a-z]{2}$/i.test(code)) return "🌍";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/**
 * Cached per locale. `Intl.DisplayNames` is expensive to construct and this
 * runs once per row, but a single shared instance would pin every later caller
 * to whichever locale happened to ask first.
 */
const countryNames = new Map<string, Intl.DisplayNames>();

/** "NG" → "Nigeria". Falls back to the code when the runtime doesn't know it. */
export function countryName(code: string | null, locale = "en"): string {
  if (!code) return "Unknown";
  try {
    let names = countryNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "region" });
      countryNames.set(locale, names);
    }
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
