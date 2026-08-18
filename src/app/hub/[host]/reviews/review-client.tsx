"use client";

// The review tool, as she sees it.
//
// A mirror, not a ghostwriter. Every constraint here follows from that one sentence.
// SRT-Review-Tool-BUILD-SPEC-v2.md.
//
// NOTHING IS EVER POSTED FOR HER. She copies, she taps a link, she posts from her own
// account. There is no submit-to-Google path in this file and there must not be one.

import { useMemo, useState } from "react";
import {
  REVIEW_QUESTIONS,
  assembleLabelled,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";

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
}

export function ReviewClient({ businessName, clientId, destinations, needsSpanish }: Props) {
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  // Her edits after assembly. The textarea is NEVER read-only: her authorship has to be
  // true in fact, not only in framing.
  const [edited, setEdited] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const assembled = useMemo(() => assemblePlain(answers), [answers]);
  const labelled = useMemo(() => assembleLabelled(answers), [answers]);
  const text = edited ?? assembled;
  const nothingTyped = isEmpty(answers);

  function set(key: keyof ReviewAnswers, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Her edits are hers. Re-assembling over them when she goes back and changes an answer
    // would silently discard what she typed in the box.
    setEdited(null);
    setCopied(false);
  }

  async function store(postedDestination?: string) {
    try {
      const res = await fetch("/api/hub/reviews/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, answers, submissionId, postedDestination }),
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

  return (
    <>
      <p className="hub-eyebrow">{businessName}</p>
      <h1>Four questions, in your own words</h1>
      <p className="hub-lede">
        About ninety seconds. Answer whichever you like and skip the rest. Nothing is posted
        unless you post it yourself.
      </p>

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
        </div>
      ))}

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
          <textarea
            className="rev-out"
            rows={8}
            value={text}
            onChange={(e) => {
              setEdited(e.target.value);
              setCopied(false);
            }}
          />

          <button type="button" className="rev-primary" onClick={copy}>
            {copied ? "Copied" : "Copy my words"}
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
        </>
      )}
    </>
  );
}
