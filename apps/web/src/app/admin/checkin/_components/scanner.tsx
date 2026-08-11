"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";

/**
 * A camera that reads tickets continuously, which is the whole difference
 * between a door that moves and one that doesn't.
 *
 * The old flow was: buyer shows a QR, volunteer opens the phone camera app,
 * the QR is a URL, the OS offers a banner, the volunteer taps it, a page
 * loads, the code is admitted, the volunteer navigates back. Call it eight
 * seconds when nothing goes wrong. Five hundred guests through one door is
 * then over an hour of queue, and the queue is what people remember about an
 * event. This decodes in place at roughly ten frames a second and never
 * navigates, so the volunteer holds the phone still and guests walk past it.
 *
 * Two decoders, because of one browser. Chrome on Android has
 * `BarcodeDetector` natively and it is faster and cheaper than anything we
 * could ship. Safari has never implemented it — the iOS 17 feature flag
 * stopped working in iOS 18 and there is no sign of it returning — and an
 * iPhone is what most sellers are holding. So WebAssembly is the floor and
 * the native API is the optimisation, rather than the other way around.
 */

/** Ignore the same code for this long, so one held-up phone admits once. */
const REPEAT_MS = 2_500;
/** Roughly ten frames a second: fast enough to feel instant, cheap enough
 *  that a mid-range phone doesn't heat up over a three-hour door. */
const FRAME_MS = 100;
/** Frames are downscaled before decoding — a 4K camera buys nothing here. */
const DECODE_WIDTH = 640;

type Decoder = (source: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

/** Chrome's own, when it exists. */
function nativeDecoder(): Decoder | null {
  const Ctor = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => {
        detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      };
    }
  ).BarcodeDetector;
  if (!Ctor) return null;

  const detector = new Ctor({ formats: ["qr_code"] });
  return async (video) => {
    const found = await detector.detect(video);
    return found[0]?.rawValue ?? null;
  };
}

/**
 * The WebAssembly fallback.
 *
 * Loaded with a dynamic import so a megabyte of decoder never lands in any
 * bundle but this one, and never at all on a phone that has the native API.
 * The wasm binary is served from our own origin: the package would otherwise
 * fetch it from a CDN, and `connect-src 'self'` in the CSP would block that
 * silently — a scanner that initialises, reports no error, and never reads
 * anything.
 */
async function wasmDecoder(): Promise<Decoder> {
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");

  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? "/zxing_reader.wasm" : `${prefix}${path}`,
    },
    fireImmediately: true,
  });

  return async (video, canvas) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !video.videoWidth) return null;

    const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const results = await readBarcodes(
      context.getImageData(0, 0, canvas.width, canvas.height),
      {
        formats: ["QRCode"],
        maxNumberOfSymbols: 1,
        // A ticket QR fills the frame and is held still for a moment. Trying
        // harder buys accuracy on damaged codes at several times the cost per
        // frame, which here is paid as a visibly slower door.
        tryHarder: false,
      },
    );
    return results[0]?.text ?? null;
  };
}

export type ScannerLabels = {
  starting: string;
  blocked: string;
  blockedBody: string;
  ready: string;
};

export function Scanner({
  onCode,
  paused = false,
  labels,
}: {
  onCode: (code: string) => void;
  /** Held while a result is on screen, so the next guest isn't read early. */
  paused?: boolean;
  labels: ScannerLabels;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"starting" | "running" | "blocked">(
    "starting",
  );

  // Refs, not state: the decode loop reads these every frame and must not be
  // torn down and rebuilt each time a result comes back.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const emit = useCallback((raw: string) => {
    const now = Date.now();
    const last = lastRef.current;
    // A phone held in front of the lens decodes the same code thirty times.
    // Only the first of those is a person walking through a door.
    if (last.code === raw && now - last.at < REPEAT_MS) return;
    lastRef.current = { code: raw, at: now };
    onCodeRef.current(raw);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, and a resolution the decoder can actually use.
          // Asking for more makes every frame more expensive to downscale.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
          audio: false,
        });
      } catch {
        /*
         * Denied, unavailable, or blocked by policy — and the volunteer does
         * not need to know which. What they need is the other tab, which is
         * why this is a state and not a thrown error: a door with no camera
         * still has a list and a keypad, and the screen has to say so rather
         * than showing a black rectangle.
         */
        if (!stopped) setState("blocked");
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (stopped || !video || !canvas) return;

      video.srcObject = stream;
      // iOS refuses to play an unmuted inline video without a gesture.
      video.muted = true;
      await video.play().catch(() => undefined);

      const decode = nativeDecoder() ?? (await wasmDecoder());
      if (stopped) return;
      setState("running");

      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && video.readyState >= 2) {
          try {
            const raw = await decode(video, canvas);
            if (raw) emit(raw);
          } catch {
            // One unreadable frame is not an error worth showing anybody.
            // The next one is a hundred milliseconds away.
          }
        }
        timer = setTimeout(tick, FRAME_MS);
      };
      void tick();
    }

    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Releasing the track is what turns the phone's camera light off. A
      // volunteer who navigates away and finds the light still on assumes the
      // app is recording them.
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [emit]);

  if (state === "blocked") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50 p-8 text-center">
        <CameraOff className="size-8 text-ink-400" />
        <p className="text-sm font-medium text-ink-900">{labels.blocked}</p>
        <p className="max-w-xs text-xs text-ink-500">{labels.blockedBody}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink-950">
      <video
        ref={videoRef}
        playsInline
        muted
        // `aspect-square` rather than the camera's own ratio: a door is worked
        // in portrait with one hand, and a full-height viewfinder puts the
        // result card below the fold exactly when it matters most.
        className="aspect-square w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* The frame a volunteer aims with. Nothing enforces it — the decoder
          reads the whole image — but people aim at a box if you draw one. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="size-2/3 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>

      <p
        aria-live="polite"
        className="absolute inset-x-0 bottom-0 bg-black/50 py-2 text-center text-xs font-medium text-white"
      >
        {state === "starting" ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            {labels.starting}
          </span>
        ) : (
          labels.ready
        )}
      </p>
    </div>
  );
}
