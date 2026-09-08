"use client";

// The review tool, as she sees it.
//
// A mirror, not a ghostwriter. Every constraint here follows from that one sentence.
// SRT-Review-Tool-BUILD-SPEC-v2.md.
//
// NOTHING IS EVER POSTED FOR HER. She copies, she taps a link, she posts from her own
// account. There is no submit-to-Google path in this file and there must not be one.
//
// ‼️ NO MODEL TOUCHES ANY OF THIS, AND TWO FEATURES ADDED 2026-08-25 ARE WHERE THAT GETS TESTED.
//
// Matthew asked for reviews rewritten to a sixth-grade reading level with an emotional hook
// added. That is generating review content the customer did not write, attributed to her, on
// the client's Google profile: FTC 16 CFR Part 465, the Rytr fact pattern. He was told why and
// chose two things that stay on the right side of it:
//
//   1. A MICROPHONE that runs entirely on her device, so she can speak instead of type.
//   2. A READABILITY HINT that POINTS at long sentences and never supplies different ones.
//
// Both are below. Neither may quietly become the thing that was declined.
//
// ‼️ 2026-09-04 ADDED A STAR RATING, AN ATTESTATION AND A PRIVATE NOTE. Three features that
// each look like the thing this file refuses, and are not, for one reason apiece:
//
//   - THE STARS ROUTE NOTHING. Gating is a rating that decides whether she sees the public
//     review link. Here every value 1 to 5 reaches the same questions, the same editable box
//     and the same destination links. The stars are captured for the client's own reporting.
//   - THE PRIVATE NOTE IS BELOW THE LINKS AND OFFERED TO EVERYONE. It adds a channel; it
//     removes none. Conditioning it on a low rating would rebuild the gating funnel exactly.
//   - THE ATTESTATION GATES THE COPY BUTTON AND NOTHING ELSE. It is evidence, not a filter.
//
// scripts/_probe-review-gating.ts asserts the first two BY READING THIS SOURCE. It is a source
// probe, not a render probe: it strips comments, subtracts five exact expressions involving the
// rating, and fails on anything left. Read "THE FIVE EXPRESSIONS" below before touching the
// stars, because a one-character change to any of them fails the build for a good reason.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ 2026-09-08: IT IS A CHAT NOW, AND IT HAS NO MODEL IN IT.
//
// Four stacked textareas asked for four paragraphs at once, on a phone, in the evening, from
// somebody who is doing this as a favour. One question at a time, arriving as messages, asks
// for one sentence four times. Same four questions, same order, same assembly, same everything
// stored.
//
// It COPIES THE SHAPE of src/app/onboarding2/chat-bubble.tsx and shares no code with it, which
// is deliberate twice over:
//
//   - That component is driven by runConversationWithTools. This one is a scripted walk of
//     REVIEW_QUESTIONS by index. No generation, no branching on what she says, no network round
//     trip per turn. The typing indicator is therefore an honest short pause between scripted
//     bubbles and never a cover for a model thinking, because nothing is thinking.
//   - That component is Tailwind on near-black with no stylesheet. This one is .rev-* rules in
//     hub.css written against the skin tokens, so it carries the client's own colours, radius,
//     measure and type scale. Importing it would render a black box on a client's white page.
//
// The build spec's "no shared components with /onboarding" is intact: the shape was copied by
// hand, the engine was not.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REVIEW_QUESTIONS,
  assembleLabelled,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";
import { analyse, mergeMarks } from "@/lib/hub/readability";

export interface ReviewDestination {
  key: string;
  label: string;
  url: string;
}

/**
 * Which of the three chat looks to render.
 *
 * ‼️ PREVIEW ONLY, AND THERE IS NO COLUMN BEHIND IT. Matthew asked for three variations to pick
 * from. They are three CSS skins over identical markup, selected by a query param that only the
 * internal login-required design preview passes. A client host never sets it and gets "a". When
 * he picks, the winner becomes the default here and the other two can go.
 */
export type ChatLook = "a" | "b" | "c";

interface Props {
  businessName: string;
  clientId: string;
  destinations: ReviewDestination[];
  needsSpanish: boolean;
  /** `clients.language`. Distinct from needsSpanish, which is also true for "both". */
  language: string | null;
  /** Preview-only. Absent everywhere a real customer can reach. */
  look?: ChatLook;
}

// ─────────────────────────────────────────────────────────────────────────────
// The microphone
//
// ‼️ ON HER DEVICE, AND THAT IS THE WHOLE REASON IT IS THIS API AND NOT OUR TRANSCRIBER.
//
// `src/lib/clients/voice-notes.ts` has a working `transcribeAudio()` that posts bytes to
// OpenAI whisper-1. It must NOT be wired in here, and the argument is the schema comment on
// `review_tool_submissions`: that table has deliberately no column for a name, email, phone,
// IP, user agent or session id, and the ABSENCE OF THE COLUMN IS THE ENFORCEMENT. Uploading a
// customer's recorded voice, from a page on a client's own domain, is precisely the category
// of thing that table is built to be unable to hold. A voice is more identifying than any of
// the fields it refuses to store.
//
// The browser's SpeechRecognition keeps the audio on her phone. Nothing reaches our servers,
// nothing is recorded, and there is nothing to delete afterwards.
//
// ‼️ AND NO MediaRecorder, EVER, NOT EVEN TO ASK FOR THE PERMISSION. The priming screen below
// primes by constructing a recogniser and aborting it in the same tick, or by asking
// getUserMedia and stopping every track immediately. Neither holds an open stream, because an
// open microphone behind a spinner is a recording device by every definition that matters.
//
// Feature-detected on the client only. Chrome and Safari have it behind two different names;
// Firefox has neither. Where it is absent the button is simply not rendered, the priming screen
// is SKIPPED ENTIRELY rather than shown and dismissed, and the keyboard is exactly as it was —
// no fallback, no upload path, no apology, and no permission asked for a thing that cannot run.
// ─────────────────────────────────────────────────────────────────────────────

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
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

/**
 * Milliseconds between scripted bubbles, so two arriving together read as somebody typing
 * rather than as a page loading. Same idea as BUBBLE_GAP_MS in lib/onboarding2/texting.ts, and
 * a local constant rather than an import because that module is the funnel's and this file
 * borrows its manners, not its dependencies.
 */
const BUBBLE_GAP_MS = { min: 400, max: 900 } as const;

/**
 * How long the priming screen waits before it offers a way past.
 *
 * ‼️ IT IS A FLOOR, NOT A CONDITION. It runs whether the permission was granted, denied,
 * dismissed, blocked by policy, or never asked because the browser has no such API. Anything
 * that only appears on success is a wall for everybody else, and the one thing a page held by a
 * customer doing somebody a favour cannot be is stuck.
 */
const PRIMING_ESCAPE_MS = 3000;

type Stage = "stars" | "priming" | "chat";

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
}

export function ReviewClient({
  businessName,
  clientId,
  destinations,
  needsSpanish,
  language,
  look = "a",
}: Props) {
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  // Her edits after assembly. The textarea is NEVER read-only: her authorship has to be
  // true in fact, not only in framing.
  const [edited, setEdited] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // ───────────────────────────────────────────────────────────────────────────
  // The rating, and the one thing it is allowed to do
  //
  // ‼️ IT OPENS THE PAGE AND IT ROUTES NOTHING. There is no branch anywhere below that reads
  // the rating to decide which questions to show, whether to reveal the notes, or whether to
  // render a destination link. A one and a five walk the identical path to the identical
  // button. That is not a nicety: routing by rating is review gating, which Google's Business
  // Profile policy prohibits outright and which FTC 16 CFR Part 465 reaches as suppression.
  //
  // ‼️ THE FIVE EXPRESSIONS. scripts/_probe-review-gating.ts removes these five strings from
  // this file, byte for byte, and then fails if the word survives anywhere else:
  //
  //     const [rating, setRating] = useState<number | null>(null)
  //     aria-checked={rating === n}
  //     className={rating !== null && n <= rating ? "is-on" : undefined}
  //     onClick={() => setRating(n)}
  //     rating,
  //
  // So the star markup below is unchanged from the version that probe was written against, and
  // ADVANCING OFF THE STARS DOES NOT READ THE VALUE. The obvious way to move to the next screen
  // is to watch the number, and the moment anything does that this file has a branch keyed on
  // how happy she is, one screen away from the branch that would decide what she is shown. So
  // the advance hangs off the ROW, which sees the click bubble up from whichever button she
  // pressed and learns only that a star was tapped. `starsAnswered` is a boolean about whether
  // she answered, never about what she answered.
  //
  // `privateNote` is an ADDITION offered alongside the public path, never a substitute for it.
  // The moment it replaces the review link for anybody, this file is doing the thing it was
  // built not to do. scripts/_probe-review-gating.ts fails the build if that changes.
  // ───────────────────────────────────────────────────────────────────────────
  const [rating, setRating] = useState<number | null>(null);
  const [starsAnswered, setStarsAnswered] = useState(false);
  const [privateNote, setPrivateNote] = useState("");
  const [attested, setAttested] = useState(false);

  // Detected after mount so the server render and the first client render agree. Doing this
  // during render would hydrate a button that is not in the server HTML.
  const [micAvailable, setMicAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Set only by a deliberate tap on Stop. See dictate().
  const stoppedByHerRef = useRef(false);

  // ── The walk ───────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("stars");
  const [step, setStep] = useState(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [composed, setComposed] = useState("");
  const [micDecided, setMicDecided] = useState(false);
  const [escapeReady, setEscapeReady] = useState(false);

  // ‼️ THE COMPOSER'S VALUE, MIRRORED IN A REF, AND IT IS NOT A CONVENIENCE. SpeechRecognition's
  // onend fires outside React's world, long after the render that installed it. Reading the text
  // by calling setComposed with an updater that also DID something would run that side effect
  // twice under StrictMode and send her answer twice. And closing over `composed` directly would
  // capture whatever it was when she tapped the microphone, which is by definition before she
  // said anything. A ref is the only one of the three that is neither.
  const composedRef = useRef("");
  useEffect(() => {
    composedRef.current = composed;
  }, [composed]);

  // Same problem, same fix: onend must commit the answer for the question that is open WHEN SHE
  // STOPS, and commit() is a new closure every render.
  const commitRef = useRef<(value: string) => void>(() => {});

  const bubbleId = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const asked = useRef<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMicAvailable(speechRecognition() !== null);
    const pending = timers.current;
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const assembled = useMemo(() => assemblePlain(answers), [answers]);
  const labelled = useMemo(() => assembleLabelled(answers), [answers]);
  const text = edited ?? assembled;
  const nothingTyped = isEmpty(answers);
  const reading = useMemo(() => analyse(text), [text]);

  /** One scheduled thing, remembered so unmount can cancel it. */
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
   * Post the question at `index` as a message, after a short pause.
   *
   * ‼️ THE PAUSE IS NOT A LOADING STATE AND MUST NEVER BECOME ONE. Nothing is being fetched and
   * nothing is being generated; the whole script is in the bundle. It is here because four
   * messages appearing in one frame reads as a form, and one message appearing a beat later
   * reads as a person. CHAT_UI in config/onboarding2.ts records the same rule for the funnel:
   * the waiting state is three dots and never a sentence claiming something is thinking.
   */
  const ask = useCallback(
    (index: number) => {
      if (index >= REVIEW_QUESTIONS.length) return;
      if (asked.current.has(index)) return;
      asked.current.add(index);
      setTyping(true);
      const gap = index === 0 ? BUBBLE_GAP_MS.min : BUBBLE_GAP_MS.max;
      later(() => {
        setTyping(false);
        push("them", REVIEW_QUESTIONS[index].prompt);
      }, gap);
    },
    [later, push]
  );

  // The opener, then the first question. Two bubbles staggered, the shape the funnel uses.
  useEffect(() => {
    if (stage !== "chat") return;
    if (bubbles.length > 0 || asked.current.size > 0) return;
    push("them", `Thanks for doing this. Four short questions about ${businessName}.`);
    later(() => ask(0), BUBBLE_GAP_MS.max);
  }, [stage, bubbles.length, businessName, push, later, ask]);

  // Keep the newest message in view. Chat convention, and on a phone the composer is at the
  // bottom, so without this the question she is answering scrolls off.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles, typing]);

  // ── The priming screen ─────────────────────────────────────────────────────
  //
  // Two ways out and they race: she grants (or refuses) and the permission query tells us, or
  // the timer runs out. Whichever happens first, she moves on.
  useEffect(() => {
    if (stage !== "priming") return;

    let live = true;

    // ‼️ PRIME WITHOUT HOLDING ANYTHING OPEN. Start a recogniser and abort it in the same tick.
    // The browser shows its permission prompt on start(); abort() tears the session down before
    // a single result can arrive. Nothing is captured, nothing is buffered, nothing is kept.
    const Ctor = speechRecognition();
    if (Ctor) {
      try {
        const probe = new Ctor();
        probe.lang = language === "es" ? "es-ES" : "en-US";
        probe.onresult = null;
        probe.onend = null;
        probe.onerror = null;
        probe.start();
        if (probe.abort) probe.abort();
        else probe.stop();
      } catch {
        // A browser that refuses to start one is a browser she will answer by keyboard. The
        // timer below is the whole recovery.
      }
    }

    // Where the Permissions API knows, it resolves the spinner the moment she taps Allow rather
    // than making her wait out a timer she has already satisfied. Unsupported is "unknown", not
    // "denied": Safari has no microphone descriptor and throws on the query.
    const perms = (navigator as unknown as {
      permissions?: { query: (d: { name: string }) => Promise<{ state: string; onchange: (() => void) | null }> };
    }).permissions;

    if (perms?.query) {
      perms
        .query({ name: "microphone" })
        .then((status) => {
          if (!live) return;
          const settle = () => {
            if (!live) return;
            if (status.state === "granted" || status.state === "denied") setMicDecided(true);
          };
          settle();
          status.onchange = settle;
        })
        .catch(() => {
          // Unknown. The timer is the answer.
        });
    }

    const escape = later(() => {
      if (live) setEscapeReady(true);
    }, PRIMING_ESCAPE_MS);

    return () => {
      live = false;
      clearTimeout(escape);
    };
  }, [stage, language, later]);

  // A decision, either way, moves her on. Denial is not a failure state: the keyboard was
  // always there and the next screen is the same screen.
  useEffect(() => {
    if (stage === "priming" && micDecided) setStage("chat");
  }, [stage, micDecided]);

  /**
   * Leave the stars.
   *
   * ‼️ WHERE THERE IS NO SpeechRecognition THIS SKIPS THE PRIMING SCREEN ENTIRELY. Firefox has
   * neither name for the API. Showing a permission interstitial for a capability that cannot
   * run would be asking somebody to grant access to nothing, and then taking it away again.
   */
  function leaveStars() {
    setStage(micAvailable ? "priming" : "chat");
  }

  function commit(value: string) {
    const key = REVIEW_QUESTIONS[step]?.key;
    if (!key) return;
    const body = value.trim();
    if (body) {
      push("her", body);
      setAnswers((prev) => ({ ...prev, [key]: body }));
      // Her edits are hers. Re-assembling over them when she goes back and changes an answer
      // would silently discard what she typed in the box.
      setEdited(null);
      setCopied(false);
    }
    setComposed("");
    const next = step + 1;
    setStep(next);
    if (next < REVIEW_QUESTIONS.length) {
      later(() => ask(next), BUBBLE_GAP_MS.min);
    } else {
      later(() => push("them", "That is everything. Here are your own words, back."), BUBBLE_GAP_MS.min);
    }
  }

  /**
   * Dictate into the composer.
   *
   * ‼️ THE TRANSCRIPT LANDS IN THE BAR, NOT STRAIGHT INTO THE CONVERSATION, AND THE DIFFERENCE
   * IS ONE TAP THAT IS WORTH IT. SpeechRecognition ends itself on a pause, so sending on `onend`
   * would post half a thought as her message the moment she stopped to think, and a message
   * already sent is not a thing she can fix. Stopping DELIBERATELY sends, which is the gesture
   * Matthew described: press, speak, tap, it lands. A pause that ends the session on its own
   * leaves the words in the bar with the Send button lit.
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
    // ‼️ Spanish ONLY on an es client, never on "both". needsSpanish is true for both, and
    // forcing es-ES recognition on a bilingual client would garble an English speaker's words
    // into Spanish-shaped nonsense she then has to retype.
    recognition.lang = language === "es" ? "es-ES" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    // Appended to whatever is already in the bar, so speaking after typing adds rather than
    // replaces, and so a second burst of dictation does not wipe the first.
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
        }),
      });
      const json = (await res.json()) as { id?: string };
      if (json.id) setSubmissionId(json.id);
    } catch {
      // Storing is for SRT's benefit, not hers. A failed write must never block her from
      // copying her own words and posting them.
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

  /**
   * The highlight layer behind the textarea.
   *
   * ‼️ THE MERGE ITSELF LIVES IN readability.ts, NOT HERE, AND THAT IS ON PURPOSE. It is the one
   * piece of this file whose correctness is not visible by reading it: the pieces have to join
   * back to exactly `text` or every mark drifts off its words, and a component is somewhere that
   * property cannot be asserted. It is pure string work next to the analysis it merges, and
   * test-onboarding-artifacts.ts proves the reassembly over a set of overlapping cases.
   */
  const highlighted = useMemo(() => mergeMarks(text, reading), [text, reading]);

  /**
   * What the hint SAYS. Counts and consequences, never replacements.
   *
   * ‼️ EVERY CLAUSE HERE IS A FACT ABOUT HER SENTENCE OR ABOUT READING IN GENERAL. "This one
   * runs long" and "short words are easier" are observations. "Try this instead" is us writing
   * her review. Read the header of src/lib/hub/readability.ts before adding a clause.
   */
  const hintLines = useMemo(() => {
    const out: string[] = [];

    if (reading.hard.length === 0) {
      out.push("Nothing here is hard to read. It is ready.");
    } else {
      const long = reading.hard.filter((h) => h.reason === "long").length;
      const dense = reading.hard.length - long;
      const parts: string[] = [];
      if (long) parts.push(`${long} run${long === 1 ? "s" : ""} long`);
      if (dense) parts.push(`${dense} pack${dense === 1 ? "s" : "s"} a lot into a short space`);
      out.push(
        `${reading.hard.length} sentence${reading.hard.length === 1 ? " is" : "s are"} shaded above: ${parts.join(
          " and "
        )}. Splitting one in two usually settles it.`
      );
    }

    const kinds = new Map<string, number>();
    for (const flag of reading.flags) kinds.set(flag.kind, (kinds.get(flag.kind) ?? 0) + 1);

    const underlined: string[] = [];
    const adverb = kinds.get("adverb") ?? 0;
    const passive = kinds.get("passive") ?? 0;
    const qualifier = kinds.get("qualifier") ?? 0;
    const complex = kinds.get("complex") ?? 0;
    if (adverb) underlined.push(`${adverb} adverb${adverb === 1 ? "" : "s"}`);
    if (passive) underlined.push(`${passive} passive phrase${passive === 1 ? "" : "s"}`);
    if (qualifier) underlined.push(`${qualifier} hedge${qualifier === 1 ? "" : "s"}`);
    if (complex) underlined.push(`${complex} long word${complex === 1 ? "" : "s"}`);

    if (underlined.length) {
      out.push(`Underlined: ${underlined.join(", ")}. Reviews read stronger without them.`);
    }

    out.push("Your call, and your words either way.");
    return out;
  }, [reading]);

  // Kept pointing at the current closure, so a transcript that lands after three renders still
  // answers the question that is on screen.
  commitRef.current = commit;

  const question = REVIEW_QUESTIONS[step];
  const canSend = composed.trim().length > 0;
  const done = step >= REVIEW_QUESTIONS.length;

  return (
    <>
      {/*
        The same .hub-head wrapper the hub bodies use, so a template's masthead treatment
        reaches this page too. Without it a banded template renders a band on learn.{domain}
        and a bare heading on reviews.{domain}, which reads as two different sites for the
        one business, the exact thing sharing a theme object exists to prevent.
        The COPY is untouched: the four questions, the wording and the flow are identical for
        every client and are not themable (Runner v3 5g).
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
            branch that reads the value. Every one of the five leads to the same four questions,
            the same box, the same links and the same private note. The row below carries the
            advance so that moving on learns THAT she tapped and never WHICH.
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
            <p className="rev-note">
              Estas preguntas aún no están disponibles en español.
            </p>
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

      {!revealed && stage === "priming" && (
        // ‼️ ONLY REACHABLE WHERE SpeechRecognition EXISTS. leaveStars() sends everyone else
        // straight to the chat, so this screen never asks for a permission it cannot use.
        <section className="rev-prime" aria-live="polite">
          <h2>One moment</h2>
          <p>
            Next you will speak your review. It helps us understand what our clients actually
            need. Please accept the microphone permission on the next screen.
          </p>
          <p className="rev-hint">
            Your voice stays on your phone. Nothing is recorded and nothing is sent to us. You
            can fix anything it gets wrong before you post.
          </p>
          <p className="rev-waiting">
            <span className="rev-spinner" aria-hidden="true" />
            waiting on microphone approval
          </p>
          {escapeReady && (
            <button type="button" className="rev-primary" onClick={() => setStage("chat")}>
              Next
            </button>
          )}
        </section>
      )}

      {!revealed && stage === "chat" && (
        <section className={`rev-chat rev-chat-${look}`}>
          <div className="rev-msgs">
            {bubbles.map((bubble) => (
              <div
                key={bubble.id}
                className={bubble.from === "her" ? "rev-msg is-her" : "rev-msg is-them"}
              >
                {bubble.text}
              </div>
            ))}

            {typing && (
              // Three dots, never a sentence about what is happening. Nothing is happening.
              <div className="rev-msg is-them rev-typing" aria-label="typing">
                <span />
                <span />
                <span />
              </div>
            )}

            <div ref={endRef} />
          </div>

          {done ? (
            <button
              type="button"
              className="rev-primary"
              onClick={reveal}
              disabled={nothingTyped}
            >
              Show my notes
            </button>
          ) : (
            <div className="rev-composer">
              {micAvailable && (
                <button
                  type="button"
                  className={`rev-mic-big${listening ? " is-live" : ""}`}
                  onClick={dictate}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop and send" : "Speak your answer"}
                >
                  <span aria-hidden="true">{listening ? "■" : "●"}</span>
                  {listening ? "Listening, tap when you are done" : "Tap and speak"}
                </button>
              )}

              <div className="rev-bar">
                <textarea
                  rows={2}
                  value={composed}
                  onChange={(e) => setComposed(e.target.value)}
                  placeholder={question ? "Type your answer" : ""}
                  aria-label={question?.prompt ?? "Your answer"}
                />
                <button
                  type="button"
                  className="rev-send"
                  onClick={() => commit(composed)}
                  disabled={!canSend}
                >
                  Send
                </button>
              </div>

              {/*
                Skippable, and this is the control that keeps that promise now the questions
                arrive one at a time. It is a COMMAND, not an answer: nothing it does puts a
                word into what gets copied. The spec's "answer whichever you like and skip the
                rest" was free when four boxes sat on one screen and has to be built once they
                do not.
              */}
              <button type="button" className="rev-skip" onClick={() => commit("")}>
                Skip this one
              </button>
            </div>
          )}
        </section>
      )}

      {revealed && (
        <>
          <h2>Your notes</h2>
          {/*
            ON SCREEN: labelled, so she can see the structure of what she wrote.
            IN THE COPY BUFFER: her sentences only. The labels are ours and they must not
            travel into what gets posted.
          */}
          <ul className="rev-bullets">
            {labelled.map((bullet) => (
              <li key={bullet.key}>
                <strong>{bullet.label}:</strong> {bullet.text}
              </li>
            ))}
          </ul>

          <p className="rev-hint">
            Edit anything below before you copy it. These are your words, and only your
            words get copied.
          </p>

          {/*
            The textarea is transparent and sits on top of a mirror div holding the same
            characters, so a highlight lands under the sentence it is about. Same technique
            every in-place highlighter uses; the two must keep identical text and identical
            typography or the words separate.
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
              rows={8}
              value={text}
              onChange={(e) => {
                setEdited(e.target.value);
                setCopied(false);
              }}
            />
          </div>

          {/*
            ‼️ THE HINT POINTS. IT DOES NOT REWRITE, AND THERE IS NO BUTTON THAT DOES.
            Read the header of this file and of src/lib/hub/readability.ts before adding one.
            "This sentence runs long" is a fact about her sentence. "Try this instead" is us
            writing her review, which is the thing this tool exists not to do. That holds for
            the word-level marks added 2026-09-08 exactly as it held for the sentences: an
            underlined adverb is an observation, an offered replacement is authorship.
          */}
          {reading.words > 0 && (
            <p className="rev-reading">
              {reading.words} word{reading.words === 1 ? "" : "s"} · reads at about a grade{" "}
              {Math.round(reading.grade)} level. {hintLines.join(" ")}
            </p>
          )}

          {/*
            ‼️ THE ATTESTATION IS THE EVIDENCE, WHICH IS WHY IT GATES THE COPY BUTTON AND
            NOTHING ELSE. FTC 16 CFR Part 465 is about reviews from people who were not
            customers and words the customer did not write. One checkbox, stored with a
            timestamp, is the difference between believing these are genuine and being able to
            show it. It does not gate the questions, the assembly or the destination links,
            because it is not a rating and must never behave like one.
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

          <button
            type="button"
            className="rev-primary"
            onClick={copy}
            disabled={!attested}
          >
            {copied ? "Copied" : "Copy and go"}
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
            The gating pattern this tool refuses is: low rating, private form, no public link.
            So this box sits BELOW the links in the DOM, is not conditional on anything she
            scored, and takes nothing away. Making it appear only under a low score would
            rebuild the funnel that FTC 16 CFR Part 465 and Google's policy exist to stop, one
            prop at a time.

            ‼️ AND IT IS BELOW THEM IN THE SOURCE, NOT ONLY ON SCREEN. The probe compares where
            "rev-private" and "rev-dests" appear in this FILE. Hoisting these blocks into a
            steps array at the top, in a different order from the one they render in, fails it.
          */}
          <details className="rev-private">
            <summary>Something you would rather tell {businessName} privately?</summary>
            <p className="rev-hint">
              This goes to the business and is not posted anywhere.
            </p>
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
