"use client";

/**
 * What a door tells a volunteer who isn't looking at the screen.
 *
 * At a real door the phone is held out at arm's length, pointed away, in the
 * dark, next to a PA. The screen is the least reliable channel there is, so
 * the decision is also a sound and a buzz: a volunteer learns within a dozen
 * guests that the short high note means "walk on" and the low double means
 * "stop and look". That is what lets them keep their eyes on the queue.
 */

type Tone = "ok" | "warn" | "bad";

/*
 * One AudioContext for the life of the page. Making one per scan leaks them —
 * browsers cap the number alive at once — and the cap is reached around the
 * two-hundredth guest, which is to say halfway through the only night that
 * matters.
 */
let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audio) return audio;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  audio = new Ctor();
  return audio;
}

const TONES: Record<Tone, { hz: number; beeps: number; ms: number }> = {
  ok: { hz: 1_040, beeps: 1, ms: 90 },
  warn: { hz: 620, beeps: 2, ms: 110 },
  bad: { hz: 300, beeps: 2, ms: 160 },
};

export function signal(tone: Tone) {
  const ctx = context();
  if (ctx) {
    // Safari suspends the context until a gesture; the first scan is one.
    if (ctx.state === "suspended") void ctx.resume();

    const { hz, beeps, ms } = TONES[tone];
    for (let n = 0; n < beeps; n++) {
      const start = ctx.currentTime + n * (ms + 60) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      osc.type = "sine";
      // Ramped rather than switched: a square-edged gate on a phone speaker
      // clicks, and a click every guest for three hours is unbearable.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    }
  }

  // Android only — iOS has no vibration API on the web — so this is a bonus
  // channel, never the only one.
  navigator.vibrate?.(tone === "ok" ? 40 : [60, 50, 60]);
}
