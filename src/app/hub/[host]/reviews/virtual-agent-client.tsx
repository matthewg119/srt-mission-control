"use client";

// The AI Referral Engine, v2: the same mirror, wearing the Virtual Agent's clothes.
//
// ‼️ READ referral-engine-client.tsx FIRST. This file is the second rendering of a regulated
// surface, not a redesign of it. Everything that file refuses, this file refuses, and
// scripts/_probe-review-gating.ts now reads BOTH. What changed is the shell and the script: a
// panel that opens over the page instead of a column on it, six questions instead of four, and
// three yes/no gates that decide which of them get asked.
//
// ‼️ THE STARS BLOCK BELOW IS COPIED FROM referral-engine-client.tsx CHARACTER FOR CHARACTER.
// The probe subtracts five exact expressions from this file and fails on any surviving mention,
// and it now also fails if any of the five is MISSING, because subtraction alone passes on a file
// with no stars in it at all. Do not tidy that block, do not rename `n`, do not move the advance
// off the row and onto the buttons. It learns THAT she tapped and never WHICH.
//
// ‼️ THERE IS NO MODEL IN HERE EITHER, AND THE PANEL IS WHERE THAT GETS TESTED. It looks like the
// concierge widget on purpose, because Matthew wants one agent across a client's whole site. It
// shares the concierge's CLASS NAMES AND TOKEN NAMES and none of its code: the concierge is a
// model conversation on another origin, and this is a scripted walk of REVIEW_SCRIPT by index
// with no network round trip per turn. Wiring this to /api/concierge/turn would put a model in
// the path that assembles a customer's review, which is the one thing the build spec forbids
// outright. FTC 16 CFR Part 465, the Rytr fact pattern.
//
// ‼️ A GATE IS A BRANCH. Tapping Yes shows "Yes" in the transcript, because that is what a chat
// looks like, and puts the word nowhere else: not in `answers`, not in the stored row, not in the
// clipboard. See answerGate(), which is the only function that handles a chip and which the probe
// reads for exactly that.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QUESTION_SET_VERSION_V4,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";
import {
  AGENT_NAME,
  CONNECTING_LINE,
  CONNECTING_MS,
  REVIEW_SCRIPT,
  fillBusiness,
  stepAfter,
} from "@/lib/hub/review-script";
import { analyse, mergeMarks } from "@/lib/hub/readability";

export interface ReviewDestination {
  key: string;
  label: string;
  url: string;
}


interface Props {
  businessName: string;
  clientId: string;
  destinations: ReviewDestination[];
  needsSpanish: boolean;
  /** `clients.language`. Distinct from needsSpanish, which is also true for "both". */
  language: string | null;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult:
    | ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const BUBBLE_GAP_MS = { min: 400, max: 900 } as const;

type Stage = "stars" | "connecting" | "chat";
type Awaiting = "none" | "text" | "gate";

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
}

export function VirtualAgentClient({
  businessName,
  clientId,
  destinations,
  needsSpanish,
  language,
}: Props) {
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  const [edited, setEdited] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // ───────────────────────────────────────────────────────────────────────────
  // ‼️ THE FIVE EXPRESSIONS. Identical to referral-engine-client.tsx, and for the same reason:
  // scripts/_probe-review-gating.ts removes these five strings from this file byte for byte and
  // then fails if the word survives anywhere else. Every value 1 to 5 walks the identical path
  // to the identical button.
  //
  //     const [rating, setRating] = useState<number | null>(null)
  //     aria-checked={rating === n}
  //     className={rating !== null && n <= rating ? "is-on" : undefined}
  //     onClick={() => setRating(n)}
  //     rating,
  // ───────────────────────────────────────────────────────────────────────────
  const [rating, setRating] = useState<number | null>(null);
  const [starsAnswered, setStarsAnswered] = useState(false);
  const [privateNote, setPrivateNote] = useState("");
  const [attested, setAttested] = useState(false);

  const [micAvailable, setMicAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedByHerRef = useRef(false);

  // ── The walk ───────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("stars");
  const [index, setIndex] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>("none");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [composed, setComposed] = useState("");
  const askingMicRef = useRef(false);
  const aliveRef = useRef(false);

  // Same reasoning as v1: SpeechRecognition's onend fires outside React's world, so the composer
  // value and the commit function are both mirrored in refs. A stale closure here sends the wrong
  // answer to the wrong question.
  const composedRef = useRef("");
  useEffect(() => {
    composedRef.current = composed;
  }, [composed]);
  const commitRef = useRef<(value: string) => void>(() => {});

  const bubbleId = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const played = useRef<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    setMicAvailable(speechRecognition() !== null);
    const pending = timers.current;
    return () => {
      aliveRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const assembled = useMemo(() => assemblePlain(answers), [answers]);
  const text = edited ?? assembled;
  const nothingTyped = isEmpty(answers);
  const reading = useMemo(() => analyse(text), [text]);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  }, []);

  const push = useCallback((from: Bubble["from"], body: string) => {
    bubbleId.current += 1;
    const id = bubbleId.current;
    setBubbles((prev) => [...prev, { id, from, text: body }]);
  }, []);

  /**
   * Play the step at `index`, then either advance or wait for her.
   *
   * ‼️ THE PAUSE IS NOT A LOADING STATE. Nothing is fetched and nothing is generated; the whole
   * script is in the bundle. Three dots, never a sentence claiming something is thinking, because
   * nothing is thinking.
   */
  useEffect(() => {
    if (stage !== "chat") return;
    if (played.current.has(index)) return;
    const current = REVIEW_SCRIPT[index];
    if (!current) return;
    played.current.add(index);

    setTyping(true);
    const gap = index === 0 ? BUBBLE_GAP_MS.min : BUBBLE_GAP_MS.max;
    later(() => {
      setTyping(false);
      if (current.kind === "say") {
        push("them", fillBusiness(current.text, businessName));
        setIndex((i) => i + 1);
        return;
      }
      push("them", fillBusiness(current.prompt, businessName));
      setAwaiting(current.kind === "gate" ? "gate" : "text");
    }, gap);
  }, [stage, index, businessName, push, later]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles, typing]);

  // Focus moves into the panel when it opens, and the page behind it stops scrolling. Without
  // both, a phone keyboard opening scrolls the page under the panel instead of the transcript.
  useEffect(() => {
    if (stage === "stars" || revealed) return;
    panelRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [stage, revealed]);

  /**
   * Leave the stars, ask for the microphone ON THIS TAP, and hand over to the agent.
   *
   * ‼️ THE PERMISSION IS REQUESTED INSIDE THE CLICK. A browser shows its box for a request made
   * during a user gesture, so getUserMedia is called synchronously here with nothing awaited
   * before it. The handover screen is what she sees while that box is open, which is also why the
   * two waits are ONE wait: v1 asked for the microphone on one screen and would now hand over on
   * another, and two spinners back to back for a customer doing somebody a favour is a page she
   * closes.
   *
   * ‼️ EVERY TRACK IS STOPPED THE INSTANT THE PROMISE RESOLVES. The stream exists only so the
   * browser asks the question. Nothing reads it and nothing records it, and there is no
   * MediaRecorder here or anywhere near this file.
   *
   * ‼️ THE HANDOVER RUNS ON ITS OWN CLOCK. It does not wait for the permission answer, because
   * getUserMedia is allowed to stay pending forever and some browsers do. Allowed, denied or
   * never answered, she reaches the agent after CONNECTING_MS.
   */
  function leaveStars() {
    if (askingMicRef.current) return;
    setStage("connecting");
    later(() => {
      if (aliveRef.current) setStage((s) => (s === "connecting" ? "chat" : s));
    }, CONNECTING_MS);

    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!micAvailable || typeof media?.getUserMedia !== "function") return;

    let request: Promise<MediaStream>;
    try {
      request = media.getUserMedia({ audio: true });
    } catch {
      // A browser that throws instead of rejecting is a browser she will answer by keyboard.
      return;
    }
    askingMicRef.current = true;
    request.then(
      (stream) => {
        stream.getTracks().forEach((track) => track.stop());
        askingMicRef.current = false;
      },
      () => {
        askingMicRef.current = false;
      }
    );
  }

  /** Her typed or spoken answer to the question that is open. */
  function commit(value: string) {
    const current = REVIEW_SCRIPT[index];
    if (!current || current.kind !== "ask") return;
    const body = value.trim();
    if (body) {
      push("her", body);
      setAnswers((prev) => ({ ...prev, [current.key]: body }));
      // Her edits are hers. Re-assembling over them would discard what she typed in the box.
      setEdited(null);
      setCopied(false);
    }
    setComposed("");
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

  /**
   * A yes/no chip, and everything it is not allowed to do.
   *
   * ‼️ IT ADVANCES THE WALK. That is the entire function. It does not store, does not reveal,
   * does not touch the private note, does not read the stars and does not write a word into
   * `answers`. The chip's label goes into the TRANSCRIPT, because a chat that does not show what
   * she tapped is not a chat, and the transcript is not what gets copied.
   *
   * ‼️ A No SKIPS THE ONE QUESTION THE GATE GUARDS AND NOTHING ELSE. stepAfter() counts forward
   * and has no destination table, so there is nowhere for "and if she says no, show her the
   * private box instead" to be added without rewriting it. That sentence is the review gating
   * funnel, prohibited by Google's Business Profile policy and reachable by the FTC as
   * suppression under 16 CFR Part 465.
   */
  function answerGate(saidYes: boolean) {
    const current = REVIEW_SCRIPT[index];
    if (!current || current.kind !== "gate") return;
    push("her", saidYes ? current.yes : current.no);
    setAwaiting("none");
    setIndex(stepAfter(index, saidYes));
  }

  /**
   * Dictate into the composer.
   *
   * ‼️ THE TRANSCRIPT LANDS IN THE BAR, NOT STRAIGHT INTO THE CONVERSATION. SpeechRecognition
   * ends itself on a pause, so sending on `onend` would post half a thought the moment she
   * stopped to think, and a message already sent is not a thing she can fix. Stopping
   * DELIBERATELY sends.
   */
  function dictate() {
    const Ctor = speechRecognition();
    if (!Ctor) return;

    if (listening) {
      stoppedByHerRef.current = true;
      recognitionRef.current?.stop();
      return;
    }

    recognitionRef.current?.stop();
    const recognition = new Ctor();
    // Spanish ONLY on an es client, never on "both": forcing es-ES on a bilingual client garbles
    // an English speaker's words into Spanish-shaped nonsense she then has to retype.
    recognition.lang = language === "es" ? "es-ES" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let heard = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) heard += result[0].transcript;
      }
      if (!heard.trim()) return;
      setComposed((existing) =>
        existing.trim() ? `${existing.replace(/\s+$/, "")} ${heard.trim()}` : heard.trim()
      );
    };

    recognition.onend = () => {
      setListening(false);
      if (stoppedByHerRef.current) {
        stoppedByHerRef.current = false;
        const spoken = composedRef.current;
        if (spoken.trim()) commitRef.current(spoken);
      }
    };
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    stoppedByHerRef.current = false;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }

  async function store(postedDestination?: string) {
    try {
      const res = await fetch("/api/hub/reviews/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          answers,
          submissionId,
          postedDestination,
          rating,
          privateNote: privateNote.trim() || undefined,
          attested,
          questionSetVersion: QUESTION_SET_VERSION_V4,
        }),
      });
      const json = (await res.json()) as { id?: string };
      if (json.id) setSubmissionId(json.id);
    } catch {
      // Storing is for SRT's benefit, not hers. A failed write must never block her from copying
      // her own words and posting them.
    }
  }

  function reveal() {
    setRevealed(true);
    // Stored whether or not she goes on to post. The language is the asset either way.
    void store();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const highlighted = useMemo(() => mergeMarks(text, reading), [text, reading]);

  /**
   * The rail beside her words. Counts and consequences, never replacements.
   *
   * ‼️ EVERY ROW IS A COUNT OF SOMETHING IN HER SENTENCE. "2 sentences run long" is an
   * observation. "Try this instead" is us writing her review, and there is no button that does
   * it. Read the header of src/lib/hub/readability.ts before adding a row.
   */
  const rail = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const flag of reading.flags) kinds.set(flag.kind, (kinds.get(flag.kind) ?? 0) + 1);
    const long = reading.hard.filter((h) => h.reason === "long").length;
    const dense = reading.hard.length - long;
    return [
      { key: "long", mark: "long", label: "Sentences that run long", n: long },
      { key: "dense", mark: "dense", label: "Sentences packed tight", n: dense },
      { key: "adverb", mark: "adverb", label: "Adverbs", n: kinds.get("adverb") ?? 0 },
      { key: "passive", mark: "passive", label: "Passive phrases", n: kinds.get("passive") ?? 0 },
      { key: "qualifier", mark: "qualifier", label: "Hedges", n: kinds.get("qualifier") ?? 0 },
      { key: "complex", mark: "complex", label: "Long words", n: kinds.get("complex") ?? 0 },
    ];
  }, [reading]);

  const clean = rail.every((row) => row.n === 0);

  // Kept pointing at the current closure, so a transcript that lands after three renders still
  // answers the question that is on screen.
  commitRef.current = commit;

  const step = REVIEW_SCRIPT[index];
  const canSend = composed.trim().length > 0;
  const done = !step;
  const chatting = !revealed && (stage === "connecting" || stage === "chat");

  return (
    <>
      {/*
        The masthead stays rendered behind the panel. It is the one thing that makes
        reviews.{domain} look like the same business as learn.{domain}, and in `full` the panel
        simply covers it rather than the page having to render two ways.
        The COPY is untouched and is not themable (Runner v3 5g).
      */}
      <header className="hub-head">
        <p className="hub-eyebrow">{businessName}</p>
        <h1>Leave us a review</h1>
        <p className="hub-lede">
          About ninety seconds. Answer whichever you like and skip the rest. Nothing is posted
          unless you post it yourself.
        </p>
      </header>

      {!revealed && stage === "stars" && (
        <>
          {/*
            ‼️ THE STARS DECIDE NOTHING. Read the state declaration above before adding any
            branch that reads the value. Every one of the five leads to the same questions, the
            same box, the same links and the same private note. The row below carries the advance
            so that moving on learns THAT she tapped and never WHICH.

            ‼️ COPIED FROM referral-engine-client.tsx CHARACTER FOR CHARACTER. The probe asserts
            all five expressions are present here, unchanged. Do not tidy it.
          */}
          <fieldset className="rev-stars">
            <legend>How would you rate your experience?</legend>
            <div
              className="rev-stars-row"
              role="radiogroup"
              aria-label="Rating out of five"
              onClick={() => setStarsAnswered(true)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  className={rating !== null && n <= rating ? "is-on" : undefined}
                  onClick={() => setRating(n)}
                >
                  <span aria-hidden="true">★</span>
                </button>
              ))}
            </div>
          </fieldset>

          {needsSpanish && (
            // Rendered rather than hidden, because a Spanish-speaking customer being handed
            // English questions is a real thing to notice, and the spec forbids inventing the
            // Spanish here.
            <p className="rev-note">Estas preguntas aún no están disponibles en español.</p>
          )}

          <button
            type="button"
            className="rev-primary"
            onClick={leaveStars}
            disabled={!starsAnswered}
          >
            Next
          </button>
        </>
      )}

      {chatting && (
        /*
          The panel opens OVER the page and closes when the walk ends, so the masthead, her stars
          and the client's mark stay where they were, and her notes land on a normal page with room
          for the reading rail beside them.

          ‼️ A FULL-SCREEN VARIANT WAS BUILT, WALKED AND REJECTED (2026-09-24). It deleted the
          masthead and the client's mark, which are the only things making reviews.{domain} look
          like the same business as learn.{domain}, and it put the notes step, the rail, the
          attestation, the destination links and the private note inside one fixed scrolling
          column. If somebody proposes it again, that is what it costs.
        */
        <div className="va-shell">
          <div className="va-scrim" aria-hidden="true" />
          <div
            className="va-panel"
            role="dialog"
            aria-modal="true"
            aria-label={AGENT_NAME}
            tabIndex={-1}
            ref={panelRef}
          >
            <div className="va-head">
              <span className="va-avatar" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h16v12H8l-4 4z" />
                </svg>
              </span>
              <span className="va-title">{AGENT_NAME}</span>
            </div>

            {stage === "connecting" ? (
              // ‼️ IT SAYS WHAT IT IS DOING AND NOTHING MORE. Nobody is looking up a file. See
              // CONNECTING_LINE in review-script.ts for why this wording and not the other one.
              <div className="va-connecting" aria-live="polite">
                <span className="va-spinner" aria-hidden="true" />
                <p className="va-connecting-line">{CONNECTING_LINE}</p>
                {micAvailable && (
                  <p className="va-connecting-note">
                    You will be able to speak your answers. Please allow the microphone if your
                    browser asks. Your voice stays on your phone and nothing is recorded.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="va-msgs">
                  {bubbles.map((bubble) => (
                    <div
                      key={bubble.id}
                      className={bubble.from === "her" ? "va-msg is-her" : "va-msg is-them"}
                    >
                      {bubble.text}
                    </div>
                  ))}

                  {typing && (
                    // Three dots, never a sentence about what is happening. Nothing is happening.
                    <div className="va-msg is-them va-typing" aria-label="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}

                  <div ref={endRef} />
                </div>

                {done ? (
                  <div className="va-composer">
                    <button
                      type="button"
                      className="va-send is-wide"
                      onClick={reveal}
                      disabled={nothingTyped}
                    >
                      Show my review
                    </button>
                  </div>
                ) : awaiting === "gate" && step.kind === "gate" ? (
                  // Two chips, side by side. Neither label reaches her review; see answerGate().
                  <div className="va-chips is-pair">
                    <button type="button" className="va-chip" onClick={() => answerGate(true)}>
                      {step.yes}
                    </button>
                    <button type="button" className="va-chip" onClick={() => answerGate(false)}>
                      {step.no}
                    </button>
                  </div>
                ) : awaiting === "text" ? (
                  <div className="va-composer">
                    {micAvailable && (
                      <button
                        type="button"
                        className={`va-mic${listening ? " is-live" : ""}`}
                        onClick={dictate}
                        aria-pressed={listening}
                        aria-label={listening ? "Stop and send" : "Speak your answer"}
                      >
                        <span aria-hidden="true">{listening ? "■" : "●"}</span>
                        {listening ? "Listening, tap when you are done" : "Tap and speak"}
                      </button>
                    )}

                    <div className="va-bar">
                      <textarea
                        rows={2}
                        value={composed}
                        onChange={(e) => setComposed(e.target.value)}
                        placeholder="Type your answer"
                        aria-label={step.kind === "ask" ? step.prompt : "Your answer"}
                      />
                      <button
                        type="button"
                        className="va-send"
                        onClick={() => commit(composed)}
                        disabled={!canSend}
                      >
                        Send
                      </button>
                    </div>

                    {/*
                      A COMMAND, not an answer. Nothing it does puts a word into what gets copied.
                      "Answer whichever you like and skip the rest" was free when four boxes sat
                      on one screen and has to be built once the questions arrive one at a time.
                    */}
                    <button type="button" className="va-skip" onClick={() => commit("")}>
                      Skip this one
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {revealed && (
        <>
          {/*
            ‼️ NO LABELLED BULLET LIST. v1 showed her notes broken out by question above the box;
            Matthew asked for the message alone. The labels were ours and never travelled into the
            clipboard anyway, so removing them takes nothing away from her and removes a screen
            that read like a form receipt.
          */}
          <h2>Your review</h2>
          <p className="rev-hint">
            Edit anything below before you copy it. These are your words, and only your words get
            copied.
          </p>

          <div className="rev2-read">
            {/*
              The textarea is transparent and sits on a mirror div holding the same characters, so
              a highlight lands under the sentence it is about. The two MUST keep identical text
              and identical typography or the words separate. Only background and text-decoration
              may be added to a mark.
            */}
            <div className="rev-editor">
              <div className="rev-mirror" aria-hidden="true">
                {highlighted.map((part, i) => {
                  const flagClass = part.flag ? ` rev-flag rev-flag-${part.flag}` : "";
                  if (part.hard) {
                    return (
                      <mark key={i} className={`rev-hard rev-hard-${part.hard}${flagClass}`}>
                        {part.text}
                      </mark>
                    );
                  }
                  return (
                    <span key={i} className={flagClass.trim() || undefined}>
                      {part.text}
                    </span>
                  );
                })}
                {"\n"}
              </div>
              <textarea
                className="rev-out"
                rows={10}
                value={text}
                onChange={(e) => {
                  setEdited(e.target.value);
                  setCopied(false);
                }}
              />
            </div>

            {/*
              ‼️ THE RAIL POINTS. IT DOES NOT REWRITE, AND THERE IS NO BUTTON THAT DOES.
              "This sentence runs long" is a fact about her sentence. "Try this instead" is us
              writing her review, which is the thing this tool exists not to do. That holds for
              every row below exactly as it holds for the marks they count.
            */}
            <aside className="rev2-rail" aria-label="Readability">
              <p className="rev2-rail-head">
                {reading.words} word{reading.words === 1 ? "" : "s"}
                {reading.words > 0 ? ` · grade ${Math.round(reading.grade)}` : ""}
              </p>

              {clean ? (
                <p className="rev2-rail-clear">
                  {reading.words > 0
                    ? "Nothing here is hard to read. It is ready."
                    : "Your words will be checked here as you write."}
                </p>
              ) : (
                <ul className="rev2-rail-rows">
                  {rail
                    .filter((row) => row.n > 0)
                    .map((row) => (
                      <li key={row.key}>
                        <span className={`rev2-key rev2-key-${row.mark}`} aria-hidden="true" />
                        <span className="rev2-rail-label">{row.label}</span>
                        <span className="rev2-rail-n">{row.n}</span>
                      </li>
                    ))}
                </ul>
              )}

              <p className="rev2-rail-foot">
                We point at what is shaded. We never write a replacement. Your call, and your words
                either way.
              </p>
            </aside>
          </div>

          {/*
            ‼️ THE ATTESTATION GATES THE COPY BUTTON AND NOTHING ELSE. It is evidence, not a
            filter: it does not gate the questions, the assembly or the destination links, because
            it is not a score and must never behave like one.
          */}
          <label className="rev-attest">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => {
                setAttested(e.target.checked);
                setCopied(false);
              }}
            />
            <span>I am a real customer of this business and these are my own words.</span>
          </label>

          <button type="button" className="rev-primary" onClick={copy} disabled={!attested}>
            {copied ? "Copied" : "Copy and go leave review"}
          </button>

          {destinations.length > 0 ? (
            <>
              <p className="rev-hint">Then paste it wherever you would like to post it.</p>
              <div className="rev-dests">
                {destinations.map((destination) => (
                  <a
                    key={destination.key}
                    href={destination.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => void store(destination.key)}
                  >
                    {destination.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="rev-hint">
              Copy your words, then paste them into your review on Google.
            </p>
          )}

          {/*
            ‼️ AFTER THE DESTINATION LINKS, NEVER INSTEAD OF THEM, AND OFFERED TO EVERYONE.
            The gating pattern this tool refuses is: low score, private form, no public link. So
            this box sits BELOW the links in the DOM, is not conditional on anything she scored or
            tapped, and takes nothing away.

            ‼️ AND IT IS BELOW THEM IN THE SOURCE, NOT ONLY ON SCREEN. The probe compares where
            "rev-private" and "rev-dests" appear in this FILE.
          */}
          <details className="rev-private">
            <summary>Something you would rather tell {businessName} privately?</summary>
            <p className="rev-hint">This goes to the business and is not posted anywhere.</p>
            <textarea
              rows={3}
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              placeholder="Optional"
            />
            <button type="button" className="rev-secondary" onClick={() => void store()}>
              Send privately
            </button>
          </details>
        </>
      )}
    </>
  );
}
