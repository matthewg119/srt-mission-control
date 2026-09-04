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
// scripts/_probe-review-gating.ts asserts the first two by rendering the component at every
// rating and diffing the output. If you add a branch that reads `rating`, that probe fails,
// and it is supposed to.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  REVIEW_QUESTIONS,
  assembleLabelled,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";
import { analyse } from "@/lib/hub/readability";

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
// Feature-detected on the client only. Chrome and Safari have it behind two different names;
// Firefox has neither. Where it is absent the button is simply not rendered and the keyboard
// is exactly as it was — no fallback, no upload path, no apology.
// ─────────────────────────────────────────────────────────────────────────────

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
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

export function ReviewClient({
  businessName,
  clientId,
  destinations,
  needsSpanish,
  language,
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
  // `rating` to decide which questions to show, whether to reveal the notes, or whether to
  // render a destination link. A one and a five walk the identical path to the identical
  // button. That is not a nicety: routing by rating is review gating, which Google's Business
  // Profile policy prohibits outright and which FTC 16 CFR Part 465 reaches as suppression.
  //
  // `privateNote` is an ADDITION offered alongside the public path, never a substitute for it.
  // The moment it replaces the review link for anybody, this file is doing the thing it was
  // built not to do. scripts/_probe-review-gating.ts fails the build if that changes.
  // ───────────────────────────────────────────────────────────────────────────
  const [rating, setRating] = useState<number | null>(null);
  const [privateNote, setPrivateNote] = useState("");
  const [attested, setAttested] = useState(false);

  // Detected after mount so the server render and the first client render agree. Doing this
  // during render would hydrate a button that is not in the server HTML.
  const [micAvailable, setMicAvailable] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setMicAvailable(speechRecognition() !== null);
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const assembled = useMemo(() => assemblePlain(answers), [answers]);
  const labelled = useMemo(() => assembleLabelled(answers), [answers]);
  const text = edited ?? assembled;
  const nothingTyped = isEmpty(answers);
  const reading = useMemo(() => analyse(text), [text]);

  function set(key: keyof ReviewAnswers, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Her edits are hers. Re-assembling over them when she goes back and changes an answer
    // would silently discard what she typed in the box.
    setEdited(null);
    setCopied(false);
  }

  function dictate(key: keyof ReviewAnswers) {
    const Ctor = speechRecognition();
    if (!Ctor) return;

    if (listening === key) {
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

    // Appended to whatever is already in the box, so speaking after typing adds rather than
    // replaces, and so a second burst of dictation does not wipe the first.
    recognition.onresult = (event) => {
      let heard = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) heard += result[0].transcript;
      }
      if (!heard.trim()) return;
      setAnswers((prev) => {
        const existing = prev[key] ?? "";
        const joined = existing ? `${existing.replace(/\s+$/, "")} ${heard.trim()}` : heard.trim();
        return { ...prev, [key]: joined };
      });
      setEdited(null);
      setCopied(false);
    };

    recognition.onend = () => setListening(null);
    recognition.onerror = () => setListening(null);

    recognitionRef.current = recognition;
    setListening(key);
    try {
      recognition.start();
    } catch {
      setListening(null);
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

  // The highlight layer sits behind the textarea and has to hold exactly the same characters
  // in the same order, or the highlights drift off the words they belong to.
  const highlighted = useMemo(() => {
    const parts: Array<{ text: string; hard: boolean }> = [];
    let cursor = 0;
    for (const s of reading.hard) {
      if (s.start > cursor) parts.push({ text: text.slice(cursor, s.start), hard: false });
      parts.push({ text: text.slice(s.start, s.end), hard: true });
      cursor = s.end;
    }
    parts.push({ text: text.slice(cursor), hard: false });
    return parts;
  }, [text, reading]);

  return (
    <>
      {/*
        The same .hub-head wrapper the hub bodies use, so a template's masthead treatment
        reaches this page too. Without it a banded template renders a band on learn.{domain}
        and a bare heading on reviews.{domain}, which reads as two different sites for the
        one business — the exact thing sharing a theme object exists to prevent.
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

      {/*
        ‼️ THE STARS DECIDE NOTHING. Read the state declaration above before adding any branch
        that reads `rating`. Every value leads to the same four questions below, which are
        rendered unconditionally and are NOT nested inside this block.
      */}
      <fieldset className="rev-stars">
        <legend>How would you rate your experience?</legend>
        <div className="rev-stars-row" role="radiogroup" aria-label="Rating out of five">
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

      {REVIEW_QUESTIONS.map((question) => (
        <div key={question.key} className="rev-field">
          <label htmlFor={`q-${question.key}`}>{question.prompt}</label>
          <textarea
            id={`q-${question.key}`}
            rows={3}
            value={answers[question.key] ?? ""}
            onChange={(e) => set(question.key, e.target.value)}
            placeholder="In your own words"
          />
          {micAvailable && (
            <button
              type="button"
              className={`rev-mic${listening === question.key ? " is-live" : ""}`}
              onClick={() => dictate(question.key)}
              aria-pressed={listening === question.key}
            >
              {listening === question.key ? "Stop" : "Speak instead"}
            </button>
          )}
        </div>
      ))}

      {micAvailable && (
        <p className="rev-note">
          Your voice stays on your phone. Nothing is recorded and nothing is sent. You can fix
          anything it gets wrong before you post.
        </p>
      )}

      {!revealed ? (
        <button type="button" className="rev-primary" onClick={reveal} disabled={nothingTyped}>
          Show my notes
        </button>
      ) : (
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
              {highlighted.map((part, i) =>
                part.hard ? (
                  <mark key={i}>{part.text}</mark>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
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
            writing her review, which is the thing this tool exists not to do.
          */}
          {reading.words > 0 && (
            <p className="rev-reading">
              {reading.words} word{reading.words === 1 ? "" : "s"} · reads at about a grade{" "}
              {Math.round(reading.grade)} level.{" "}
              {reading.hard.length === 0
                ? "Nothing here is hard to read. It is ready."
                : `${reading.hard.length} sentence${reading.hard.length === 1 ? " is" : "s are"} highlighted above: ${
                    reading.hard.some((h) => h.reason === "long")
                      ? "long ones are easier to read split in two."
                      : "shorter words say it just as well."
                  } Your call, and your words either way.`}
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
            So this box sits BELOW the links in the DOM, is not conditional on `rating`, and
            takes nothing away. Making it appear only under a low rating would rebuild the
            funnel that FTC 16 CFR Part 465 and Google's policy exist to stop, one prop at a
            time.
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
