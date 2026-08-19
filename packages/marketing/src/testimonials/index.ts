/**
 * The browser-safe half of spec 35: what a testimonial may say, and what an
 * embed key looks like.
 *
 * Kept out of `./server` because both sides read it — the seller's form
 * validates with the same rules the action enforces, and the embed page renders
 * a video through the same guard the write applied.
 */
import { randomHex } from "@sailo/core/token";

/** Enough for a paragraph of praise, and short enough that a grid still reads. */
export const MAX_BODY = 1_000;
export const MAX_AUTHOR_NAME = 80;
export const MAX_AUTHOR_ROLE = 120;

/** How a testimonial arrived. */
export const TESTIMONIAL_SOURCES = ["requested", "manual", "imported"] as const;
export type TestimonialSource = (typeof TESTIMONIAL_SOURCES)[number];

export const WALL_LAYOUTS = ["grid", "carousel"] as const;
export type WallLayout = (typeof WALL_LAYOUTS)[number];

export function isWallLayout(value: unknown): value is WallLayout {
  return (WALL_LAYOUTS as readonly unknown[]).includes(value);
}

/**
 * Twenty-four bytes, which is the door-pass width and for the same reason.
 *
 * `/embed/wall/[key]` is public and unauthenticated, so the key *is* the
 * authorisation: a guessable one enumerates every shop's marketing copy. Not
 * the shop id and not the handle — both are published on every storefront, so
 * either would make the embed readable by anyone who knows the shop exists,
 * including for a wall the seller has not published.
 */
export function newEmbedKey(): string {
  return randomHex(24);
}

/** Whether a string is even shaped like one, before we ask the database. */
export function looksLikeEmbedKey(value: string): boolean {
  return /^[0-9a-f]{48}$/.test(value);
}

/** Three, and the cap is the point — see `checkoutTestimonials`. */
export const CHECKOUT_TESTIMONIAL_CAP = 3;

export type SubmittedTestimonial = {
  authorName: string;
  authorRole: string | null;
  body: string | null;
  videoUrl: string | null;
  avatarUrl: string | null;
};

/** Why a submission was refused — each one is a fact about the input alone. */
export type SubmissionFailure = "name" | "empty" | "video" | "avatar";

export type SubmissionResult =
  | { ok: true; value: SubmittedTestimonial }
  | { ok: false; reason: SubmissionFailure };

/**
 * What a public submission is allowed to be.
 *
 * Both URLs are checked **here**, at the write, and not at render — the rule
 * `PRODUCTION-PLAN.md` §2 item 2 exists for. The guards are passed in rather
 * than imported so this stays browser-safe and the form can pre-check with the
 * identical predicate; `@sailo/storage/urls` is where both actually live.
 */
export function readSubmission(
  raw: {
    authorName: unknown;
    authorRole: unknown;
    body: unknown;
    videoUrl: unknown;
    avatarUrl: unknown;
  },
  guards: {
    isVideo: (value: unknown) => boolean;
    isImage: (value: unknown) => boolean;
  },
): SubmissionResult {
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

  const authorName = text(raw.authorName, MAX_AUTHOR_NAME);
  if (!authorName) return { ok: false, reason: "name" };

  const body = text(raw.body, MAX_BODY);
  const videoUrl = typeof raw.videoUrl === "string" ? raw.videoUrl.trim() : "";
  const avatarUrl = typeof raw.avatarUrl === "string" ? raw.avatarUrl.trim() : "";

  /*
   * A testimonial with neither words nor a video is an empty row on a public
   * page. Refused rather than stored, because a seller moderating a list of
   * blanks cannot tell a mistake from an attack.
   */
  if (!body && !videoUrl) return { ok: false, reason: "empty" };
  if (videoUrl && !guards.isVideo(videoUrl)) return { ok: false, reason: "video" };
  if (avatarUrl && !guards.isImage(avatarUrl)) return { ok: false, reason: "avatar" };

  return {
    ok: true,
    value: {
      authorName,
      authorRole: text(raw.authorRole, MAX_AUTHOR_ROLE) || null,
      body: body || null,
      videoUrl: videoUrl || null,
      avatarUrl: avatarUrl || null,
    },
  };
}
