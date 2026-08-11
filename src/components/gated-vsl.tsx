"use client";

// A VSL player that cannot be skipped forward, remembers where you were, and
// reveals its CTA at a real playback timestamp.
//
// Three things in here are load-bearing and look like decoration:
//
// 1. `playsInline`. Without it iOS Safari plays fullscreen and hands the viewer the
//    NATIVE scrubber, which defeats the entire gate. It is the single most important
//    attribute in this file. `disablePictureInPicture` and the `controlsList` values
//    close the other two doors to a native scrubber.
//
// 2. The seek clamp is a watermark, not a hidden seek bar. Hiding UI stops nothing:
//    keyboard arrows, media keys and PiP all seek without touching our DOM. We track
//    the furthest point real playback reached and snap forward seeks back to it.
//
// 3. The CTA reveal is driven by `currentTime`, never a setTimeout. A wall-clock
//    timer fires while the viewer is paused, on another tab, or stalled on a buffer,
//    which is the exact bug the ctaRevealSeconds prop exists to avoid.

import { useCallback, useEffect, useRef, useState } from "react";

export interface GatedVSLProps {
  /** Absolute mp4 or HLS URL. `null` renders the placeholder and reveals the CTA. */
  videoUrl: string | null;
  poster?: string | null;
  /** Fired exactly once, when playback actually reaches ctaRevealSeconds. */
  onCtaReveal: () => void;
  ctaRevealSeconds: number;
  /** Default false. True restores an ordinary seek bar. */
  allowScrub?: boolean;
  /** 'smart' resumes where they left off. 'restart' always begins at zero. */
  resumeMode?: "smart" | "restart";
  /** Distinguishes two gates over the same file, e.g. an A/B test. */
  storageKeySuffix?: string;
  unmuteLabel?: string;
  playLabel?: string;
  placeholderTitle?: string;
  placeholderBody?: string;
  className?: string;
}

/** Buffering jitter, not a skip. Seeks inside this window are left alone. */
const SEEK_TOLERANCE_SECONDS = 0.75;
/** A single timeupdate tick should never advance more than this during real play. */
const MAX_PLAUSIBLE_STEP_SECONDS = 1.5;
/** Stale progress is worse than none: a month-old position is not where they were. */
const RESUME_TTL_MS = 72 * 60 * 60 * 1000;
/** Do not bother resuming a few seconds in, or right at the end. */
const RESUME_MIN_SECONDS = 10;
const RESUME_TAIL_SECONDS = 15;
const PERSIST_EVERY_MS = 5000;

interface StoredProgress {
  t: number;
  max: number;
  revealed: boolean;
  updatedAt: number;
}

/** djb2. A signed CDN URL rotates, and hashing keeps progress attached across that. */
function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `srt:vsl:v1:${(h >>> 0).toString(36)}`;
}

// Safari private mode throws on any localStorage access, so both sides swallow.
function readProgress(key: string): StoredProgress | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProgress>;
    if (typeof parsed.t !== "number" || !Number.isFinite(parsed.t)) return null;
    return {
      t: parsed.t,
      max: typeof parsed.max === "number" ? parsed.max : parsed.t,
      revealed: parsed.revealed === true,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeProgress(key: string, value: StoredProgress): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, quota, or a blocked origin. Progress is a nicety, not a feature. */
  }
}

export function GatedVSL({
  videoUrl,
  poster,
  onCtaReveal,
  ctaRevealSeconds,
  allowScrub = false,
  resumeMode = "smart",
  storageKeySuffix = "",
  unmuteLabel = "Tap to turn the sound on",
  playLabel = "Tap to play",
  placeholderTitle = "Video coming soon",
  placeholderBody = "This video has not been recorded yet.",
  className,
}: GatedVSLProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Refs, not state: these are read inside high-frequency media event handlers and
  // must never trigger a re-render or go stale in a closure.
  const maxWatched = useRef(0);
  const revealFired = useRef(false);
  const lastPersist = useRef(0);
  const storageKey = useRef(hashKey(`${videoUrl ?? "none"}|${storageKeySuffix}`));

  // onCtaReveal is often an inline arrow from the parent, so a new identity every
  // render. Held in a ref so the effect below does not re-subscribe every render.
  const revealCb = useRef(onCtaReveal);
  revealCb.current = onCtaReveal;

  const [overlay, setOverlay] = useState<"none" | "unmute" | "play">("none");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progressPct, setProgressPct] = useState(0);

  const persist = useCallback((force = false) => {
    const v = videoRef.current;
    if (!v) return;
    const now = Date.now();
    if (!force && now - lastPersist.current < PERSIST_EVERY_MS) return;
    lastPersist.current = now;
    writeProgress(storageKey.current, {
      t: v.currentTime,
      max: maxWatched.current,
      revealed: revealFired.current,
      updatedAt: now,
    });
  }, []);

  const maybeReveal = useCallback(() => {
    const v = videoRef.current;
    if (!v || revealFired.current) return;
    if (v.currentTime >= ctaRevealSeconds) {
      revealFired.current = true;
      persist(true);
      revealCb.current();
    }
  }, [ctaRevealSeconds, persist]);

  // No video configured yet. Reveal immediately, otherwise the entire funnel below
  // this component is unreachable and untestable until the videos are shot.
  useEffect(() => {
    if (videoUrl) return;
    if (revealFired.current) return;
    revealFired.current = true;
    console.warn(
      "[GatedVSL] No videoUrl. Rendering the placeholder and revealing the CTA. " +
        "Set the corresponding NEXT_PUBLIC_MEDSPA_VSL_*_URL env var."
    );
    revealCb.current();
  }, [videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;

    const stored = resumeMode === "smart" ? readProgress(storageKey.current) : null;

    function onLoadedMetadata() {
      if (!v) return;
      if (stored && Date.now() - stored.updatedAt < RESUME_TTL_MS) {
        const duration = Number.isFinite(v.duration) ? v.duration : Infinity;
        const resumable =
          stored.t > RESUME_MIN_SECONDS && stored.t < duration - RESUME_TAIL_SECONDS;
        // Restore the watermark and the reveal flag even when the position itself is
        // not resumable, so a returning viewer is never re-gated behind content they
        // have already watched.
        maxWatched.current = Math.max(maxWatched.current, stored.max);
        if (stored.revealed) revealFired.current = true;
        if (resumable) v.currentTime = stored.t;
      }
      // A viewer already past the threshold gets the CTA now, not after re-watching.
      if (stored?.revealed) revealCb.current();
      else maybeReveal();
    }

    function onTimeUpdate() {
      if (!v) return;
      const t = v.currentTime;
      // Advance the watermark only on plausible forward progress. A jump larger than
      // one tick is a seek, and a seek must never raise the ceiling.
      if (t > maxWatched.current && t - maxWatched.current < MAX_PLAUSIBLE_STEP_SECONDS) {
        maxWatched.current = t;
      }
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setProgressPct(Math.min(100, (t / v.duration) * 100));
      }
      maybeReveal();
      persist();
    }

    function onSeeking() {
      if (!v || allowScrub) return;
      // Backward seeks pass on purpose: with no seek bar there is no way to do it by
      // accident, and someone re-hearing a line should be able to. Forward is the
      // only direction the gate cares about.
      if (v.currentTime > maxWatched.current + SEEK_TOLERANCE_SECONDS) {
        v.currentTime = maxWatched.current;
      }
    }

    function onEnded() {
      // The safety valve. If ctaRevealSeconds is longer than the file, the CTA is
      // otherwise unreachable, which is not hypothetical while the real videos do
      // not exist and every placeholder is shorter than any real threshold.
      if (!revealFired.current) {
        revealFired.current = true;
        persist(true);
        revealCb.current();
      }
      setPlaying(false);
    }

    function onPlay() {
      setPlaying(true);
    }
    function onPause() {
      setPlaying(false);
      persist(true);
    }
    function onVolumeChange() {
      if (v) setMuted(v.muted);
    }
    function onPageHide() {
      persist(true);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") persist(true);
    }

    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", maybeReveal);
    v.addEventListener("ended", onEnded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVolumeChange);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    // Muted autoplay is allowed nearly everywhere; unmuted never is. Start muted and
    // let the overlay collect the one gesture that buys us sound.
    v.muted = true;
    const attempt = v.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.then(() => setOverlay("unmute")).catch(() => setOverlay("play"));
    } else {
      setOverlay("unmute");
    }

    return () => {
      persist(true);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", maybeReveal);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("volumechange", onVolumeChange);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoUrl, allowScrub, resumeMode, maybeReveal, persist]);

  function dismissOverlay() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = 1;
    setMuted(false);
    setOverlay("none");
    void v.play().catch(() => {
      /* a second block is possible on locked-down browsers; the controls still work */
    });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  if (!videoUrl) {
    return (
      <div className={`vsl-placeholder${className ? ` ${className}` : ""}`}>
        <div className="vsl-placeholder-title">{placeholderTitle}</div>
        <p className="vsl-placeholder-body">{placeholderBody}</p>
      </div>
    );
  }

  return (
    <div className={`vsl${className ? ` ${className}` : ""}`}>
      <div className="vsl-frame">
        <video
          ref={videoRef}
          className="vsl-video"
          src={videoUrl}
          poster={poster ?? undefined}
          preload="metadata"
          // Every one of these closes a route to a native scrubber.
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          controls={allowScrub}
          muted
          onContextMenu={(e) => {
            if (!allowScrub) e.preventDefault();
          }}
        />

        {overlay !== "none" && (
          <button type="button" className="vsl-overlay" onClick={dismissOverlay}>
            <span className="vsl-overlay-icon" aria-hidden="true">
              {overlay === "unmute" ? "▶" : "▶"}
            </span>
            <span className="vsl-overlay-label">
              {overlay === "unmute" ? unmuteLabel : playLabel}
            </span>
          </button>
        )}
      </div>

      {!allowScrub && (
        <div className="vsl-bar">
          <button
            type="button"
            className="vsl-btn"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "‖" : "▶"}
          </button>

          {/* Presentation only. No input, no click target, so there is nothing to drag. */}
          <div className="vsl-track" role="presentation">
            <div className="vsl-track-fill" style={{ width: `${progressPct}%` }} />
          </div>

          <button
            type="button"
            className="vsl-btn"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      )}
    </div>
  );
}
