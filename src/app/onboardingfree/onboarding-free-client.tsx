"use client";

// One question per screen, and a tap on an option moves you on.
//
// The difference from /onboarding's funnel-client.tsx is deliberate. That form puts a
// whole step's worth of fields on one screen and saves on every Continue, because it is
// ten minutes of a clinic owner's day taken in gaps between patients and closing the tab
// must cost nothing. This one is three minutes of somebody who just replied "Yes" to an
// email, and the thing that kills it is friction, not interruption. So: one question, a
// tap, gone. Nothing is saved until the end and it is deliberately NOT resumable, because
// there is no token to resume against.
//
// TWO SUBMITS, and the split is the point. The constraint answers commit on their own and
// fire the Slack card immediately. The access screen is a second, separate post. Somebody
// who closes the tab on that screen has still told us everything that decides whether to
// take them on, which is why the source spec puts access AFTER the submit rather than in
// front of it.
//
// Validation reuses src/lib/medspa/validate.ts and src/lib/clients/normalize.ts unchanged.
// Both are pure and dependency-free, so importing them here drags nothing server-side into
// the browser bundle. That is the same split scan/steps.ts versus scan/session.ts exists
// to protect.

import { useMemo, useRef, useState } from "react";
import {
  ACCESS_COPY,
  ACCESS_FIELDS,
  DONE_COPY,
  IDENTITY_FIELDS,
  INTRO_COPY,
  SUBMITTED_COPY,
  visibleQuestions,
  type FieldDef,
  type QuestionDef,
} from "@/config/onboarding-free";
import { clean, normalizePhone, validEmail } from "@/lib/medspa/validate";
import { formatPhoneUS } from "@/lib/clients/normalize";

type Answers = Record<string, unknown>;
type Stage = "intro" | "form" | "submitted" | "access" | "done";

const CARD = "rounded-xl bg-white/5 p-6 sm:p-8";
const CTA =
  "w-full rounded-lg bg-[#00C9A7] px-6 py-3.5 font-bold text-[#04252b] disabled:opacity-50";
const INPUT_BASE =
  "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] ";

function inputClass(hasError: boolean): string {
  return INPUT_BASE + (hasError ? "border-red-400/60" : "border-white/15");
}

function optionClass(selected: boolean): string {
  return (
    "block w-full rounded-xl border px-4 py-4 text-left text-base font-semibold transition-colors " +
    (selected
      ? "border-[#00C9A7] bg-[#00C9A7]/15"
      : "border-white/15 bg-white/5 hover:border-white/30")
  );
}

/** Shared by both the identity screen and the access screen. */
function fieldError(field: FieldDef, raw: unknown): string | null {
  const value = clean(raw, 4000);
  if (field.required && !value) return "This one is needed.";
  if (!value) return null;
  if (field.kind === "email" && !validEmail(value)) {
    return "That email address does not look right.";
  }
  if (field.kind === "tel" && !normalizePhone(value)) {
    return "That phone number does not look right.";
  }
  // A name or a business typed as punctuation is the garbage this is here to stop.
  if (field.kind === "text" && field.required && !/[a-z0-9]{2}/i.test(value)) {
    return "That does not look like a real answer.";
  }
  return null;
}

export function OnboardingFreeFunnel() {
  const [stage, setStage] = useState<Stage>("intro");
  const [answers, setAnswers] = useState<Answers>({});
  const [identity, setIdentity] = useState<Answers>({});
  const [access, setAccess] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // Off screen rather than display:none, and never autofilled. Same approach the med spa
  // funnel and /onboarding both use: a hidden input is the first thing a smart bot skips.
  const [trap, setTrap] = useState("");
  // The time trap's anchor. A ref, not state, so a re-render cannot reset the clock.
  const renderedAt = useRef(Date.now());

  // Recomputed on every render, because showWhenIn makes the list dynamic. Answering
  // "More customers" removes two screens; the bar must not jump backwards afterwards.
  const questions = useMemo(() => visibleQuestions(answers), [answers]);
  // The identity screen is the last step, after every question.
  const totalSteps = questions.length + 1;
  const onIdentity = step >= questions.length;

  function setAnswer(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  }

  function advance() {
    setStep((s) => Math.min(s + 1, totalSteps - 1));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setSaveError(null);
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0 });
  }

  function answerAndAdvance(key: string, value: unknown) {
    setAnswer(key, value);
    // A short beat so the tap registers visually before the screen changes. Same feel as
    // the static funnels in srt-agwb.
    window.setTimeout(() => {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0 });
    }, 200);
  }

  function continueFromQuestion(q: QuestionDef) {
    const raw = answers[q.key];
    const empty = q.kind === "multichoice" ? !(raw as string[])?.length : !clean(raw, 4000);
    if (q.required && empty) {
      setErrors({ [q.key]: "This one is needed." });
      return;
    }
    if (q.kind === "text" && q.required && !/[a-z0-9]{2}/i.test(clean(raw, 4000))) {
      setErrors({ [q.key]: "That does not look like a real answer." });
      return;
    }
    advance();
  }

  async function submit() {
    const found: Record<string, string> = {};
    for (const field of IDENTITY_FIELDS) {
      const err = fieldError(field, identity[field.key]);
      if (err) found[field.key] = err;
    }
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/onboardingfree/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          identity: {
            business: clean(identity.business, 200),
            name: clean(identity.name, 120),
            email: clean(identity.email, 254),
            // Sent as typed. The route re-derives E.164 with normalizePhone, so the
            // stored value never depends on what the browser happened to send.
            phone: clean(identity.phone, 40),
          },
          renderedAt: renderedAt.current,
          company_url_hp: trap,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSaveError(json.error || "That did not send. Try once more.");
        setSaving(false);
        return;
      }
      setSubmissionId(json.submissionId ?? null);
      setStage("submitted");
      window.scrollTo({ top: 0 });
    } catch {
      setSaveError("That did not send. Check your connection and try once more.");
    }
    setSaving(false);
  }

  async function submitAccess() {
    const found: Record<string, string> = {};
    for (const field of ACCESS_FIELDS) {
      const err = fieldError(field, access[field.key]);
      if (err) found[field.key] = err;
    }
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/onboardingfree/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, values: access }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSaveError(json.error || "That did not send. Try once more.");
        setSaving(false);
        return;
      }
      setStage("done");
      window.scrollTo({ top: 0 });
    } catch {
      setSaveError("That did not send. Check your connection and try once more.");
    }
    setSaving(false);
  }

  // --- intro -------------------------------------------------------------
  if (stage === "intro") {
    return (
      <div className={CARD}>
        <h1 className="mb-3 text-2xl font-bold">{INTRO_COPY.heading}</h1>
        <p className="mb-8 text-white/70">{INTRO_COPY.body}</p>
        <button type="button" className={CTA} onClick={() => setStage("form")}>
          {INTRO_COPY.cta}
        </button>
      </div>
    );
  }

  // --- submitted, offering the access screen -----------------------------
  if (stage === "submitted") {
    return (
      <div className={CARD}>
        <h1 className="mb-3 text-2xl font-bold">{SUBMITTED_COPY.heading}</h1>
        <p className="mb-8 text-white/70">{SUBMITTED_COPY.body}</p>
        <button
          type="button"
          className={CTA}
          onClick={() => {
            setErrors({});
            setStage("access");
          }}
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => setStage("done")}
          className="mt-4 w-full rounded-lg px-4 py-3 text-sm text-white/50 hover:text-white"
        >
          {SUBMITTED_COPY.skip}
        </button>
      </div>
    );
  }

  // --- done --------------------------------------------------------------
  if (stage === "done") {
    return (
      <div className={`${CARD} text-center`}>
        <h1 className="mb-4 text-2xl font-bold">{DONE_COPY.heading}</h1>
        <p className="text-white/70">{DONE_COPY.body}</p>
      </div>
    );
  }

  // --- access ------------------------------------------------------------
  if (stage === "access") {
    return (
      <div className={CARD}>
        <h1 className="mb-2 text-xl font-bold sm:text-2xl">{ACCESS_COPY.heading}</h1>
        <p className="mb-6 text-sm text-white/60">{ACCESS_COPY.body}</p>
        <div className="space-y-5">
          {ACCESS_FIELDS.map((field) => (
            <Field
              key={field.key}
              def={field}
              value={access[field.key]}
              error={errors[field.key]}
              onChange={(v) => {
                setAccess((prev) => ({ ...prev, [field.key]: v }));
                setErrors((prev) => (prev[field.key] ? { ...prev, [field.key]: "" } : prev));
              }}
            />
          ))}
        </div>
        {saveError && <p className="mt-5 text-sm text-red-300">{saveError}</p>}
        <button
          type="button"
          onClick={submitAccess}
          disabled={saving}
          className={`mt-8 ${CTA}`}
        >
          {saving ? "Sending" : "Send"}
        </button>
      </div>
    );
  }

  // --- the questions -----------------------------------------------------
  const q: QuestionDef | undefined = questions[step];

  return (
    <div className={CARD}>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-white/50">
          <span>SRT</span>
          <span>
            {Math.min(step + 1, totalSteps)} of {totalSteps}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#00C9A7] transition-all"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {onIdentity ? (
        <>
          <h1 className="mb-2 text-xl font-bold sm:text-2xl">
            Last one. Who are we talking to?
          </h1>
          <div className="mt-6 space-y-5">
            {IDENTITY_FIELDS.map((field) => (
              <Field
                key={field.key}
                def={field}
                value={identity[field.key]}
                error={errors[field.key]}
                onChange={(v) => {
                  setIdentity((prev) => ({ ...prev, [field.key]: v }));
                  setErrors((prev) =>
                    prev[field.key] ? { ...prev, [field.key]: "" } : prev
                  );
                }}
              />
            ))}
          </div>
        </>
      ) : q ? (
        <>
          <h1 className="mb-2 text-xl font-bold sm:text-2xl">{q.title}</h1>
          {q.help && <p className="mb-6 text-sm text-white/55">{q.help}</p>}
          <div className={q.help ? "" : "mt-6"}>
            <Question
              def={q}
              value={answers[q.key]}
              error={errors[q.key]}
              onPick={(v) => answerAndAdvance(q.key, v)}
              onChange={(v) => setAnswer(q.key, v)}
            />
          </div>
        </>
      ) : null}

      <input
        type="text"
        name="company_url_hp"
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {saveError && <p className="mt-5 text-sm text-red-300">{saveError}</p>}

      <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            className="rounded-lg px-4 py-3 text-sm text-white/60 hover:text-white"
          >
            Back
          </button>
        )}
        {/* A single-choice question has no Continue button at all: the tap IS the
            continue. Only the screens that cannot auto-advance get one. */}
        {onIdentity ? (
          <button type="button" onClick={submit} disabled={saving} className={CTA}>
            {saving ? "Sending" : "Send"}
          </button>
        ) : q && q.kind !== "choice" ? (
          <button type="button" onClick={() => continueFromQuestion(q)} className={CTA}>
            Continue
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Question({
  def,
  value,
  error,
  onPick,
  onChange,
}: {
  def: QuestionDef;
  value: unknown;
  error?: string;
  onPick: (v: unknown) => void;
  onChange: (v: unknown) => void;
}) {
  if (def.kind === "choice") {
    return (
      <div className="flex flex-col gap-3">
        {def.options?.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            className={optionClass(value === o)}
          >
            {o}
          </button>
        ))}
        {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  if (def.kind === "multichoice") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {def.options?.map((o) => {
            const on = list.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
                className={
                  "rounded-full border px-4 py-2.5 text-sm transition-colors " +
                  (on
                    ? "border-[#00C9A7] bg-[#00C9A7]/15 font-semibold"
                    : "border-white/15 bg-white/5 hover:border-white/30")
                }
              >
                {o}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        autoFocus
        className={inputClass(!!error)}
        placeholder={def.placeholder}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function Field({
  def,
  value,
  error,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {def.label}
        {def.required && <span className="ml-1 text-[#00C9A7]">*</span>}
      </label>
      {def.help && <p className="mb-2 text-xs text-white/45">{def.help}</p>}

      {def.kind === "textarea" ? (
        <textarea
          rows={4}
          className={inputClass(!!error)}
          placeholder={def.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={def.kind === "text" ? "text" : def.kind}
          inputMode={def.kind === "tel" ? "tel" : undefined}
          autoComplete={
            def.kind === "tel" ? "tel" : def.kind === "email" ? "email" : undefined
          }
          // 14 = "(336) 833-2303". The formatter already caps at ten digits; this stops
          // the field looking like it accepted more while they were typing.
          maxLength={def.kind === "tel" ? 14 : undefined}
          className={inputClass(!!error)}
          placeholder={def.kind === "tel" ? "(336) 833-2303" : def.placeholder}
          value={String(value ?? "")}
          // A phone field formats as it is typed so a country code they type themselves
          // is absorbed rather than kept. Everything else passes through untouched.
          onChange={(e) =>
            onChange(def.kind === "tel" ? formatPhoneUS(e.target.value) : e.target.value)
          }
        />
      )}

      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}
